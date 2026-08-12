"""
Extraction du registre de caisse vers une zone tampon JSON.

    python scripts/import/extract_caisse.py "D:/Documents/Park auto" scripts/import/tampon-caisse.json

Second registre de la reprise, indépendant du costing : une feuille par jour
ouvré, 44 journées du 02/06/2026 au 31/07/2026.

STRUCTURE D'UNE JOURNÉE — deux blocs

  1. Dépenses    Prestataire | Description | Montant, close par une ligne de
                 total sans libellé.
  2. Synthèse    Recettes (solde reporté de la veille, fonds reçus), Charges
                 (le total du bloc 1), Solde Actuel.

Le solde de clôture d'un jour est le solde reporté du suivant. Cette chaîne est
ce qui rend la reprise vérifiable : une fois chargée, le solde calculé par la
plateforme depuis le grand livre doit retomber sur le dernier « Solde Actuel »
du classeur. Si ce n'est pas le cas, c'est la reprise qui a tort.

LIGNES DE CONTINUATION

Le classeur pose plusieurs véhicules sous un même paiement :

    Razack (Soudeur EURO) | MERCEDES BENZ 066765 | 10 000
                          | NISSAN DOUBLE 086239 |
    Essence               | HONDA ACCORD 037093  |  3 750
                          | NISSAN ROGUE 797864  |  3 750

Sans prestataire, la ligne prolonge la précédente. Avec un montant, c'est une
dépense de plein droit ; sans montant, c'est un second véhicule concerné par la
même dépense. Les deux cas sont distingués, faute de quoi on perdrait des
montants ou on en inventerait.
"""

import io
import json
import re
import sys
import unicodedata
from pathlib import Path

try:
    import openpyxl
except ImportError:
    sys.exit("openpyxl requis :  pip install openpyxl")


def txt(v):
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def nombre(v):
    if isinstance(v, (int, float)):
        return float(v)
    return None


def norm(s):
    sa = "".join(
        c for c in unicodedata.normalize("NFD", str(s or "")) if unicodedata.category(c) != "Mn"
    )
    return re.sub(r"\s+", " ", sa.upper()).strip()


def date_feuille(titre):
    """« 02-06-2026 » → « 2026-06-02 ». None si la feuille n'est pas une journée."""
    m = re.match(r"^(\d{2})-(\d{2})-(\d{4})$", titre.strip())
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None


# Six derniers caractères d'un châssis : c'est ainsi que le classeur désigne un
# véhicule, et c'est aussi le langage des utilisateurs. La plateforme traite
# déjà le VIN partiel comme un identifiant de plein droit.
MOTIF_VIN_COURT = re.compile(r"\b([A-Z0-9]{6})\b")


def vin_court(description):
    """Suffixe de châssis cité dans une description, s'il y en a un."""
    if not description:
        return None
    for candidat in MOTIF_VIN_COURT.findall(norm(description)):
        # Un groupe purement alphabétique est un mot, pas un châssis.
        if candidat.isalpha():
            continue
        # Une année ou un montant ne sont pas des châssis non plus.
        if candidat.isdigit() and len(candidat) == 6:
            return candidat
        if any(c.isdigit() for c in candidat) and any(c.isalpha() for c in candidat):
            return candidat
    return None


def extraire_journee(ws):
    date = date_feuille(ws.title)
    if not date:
        return None

    depenses = []
    total_declare = None
    synthese = {"solde_reporte": None, "encaissements": [], "solde_final": None}

    ligne_synthese = None
    for r in range(1, ws.max_row + 1):
        if "SYNTHESE FINANCIERE" in norm(ws.cell(row=r, column=1).value):
            ligne_synthese = r
            break
    fin_depenses = ligne_synthese or ws.max_row + 1

    # ── Bloc 1 : dépenses ───────────────────────────────────────────────────
    precedent = None
    for r in range(3, fin_depenses):
        prestataire = txt(ws.cell(row=r, column=1).value)
        description = txt(ws.cell(row=r, column=2).value)
        montant = nombre(ws.cell(row=r, column=3).value)

        if prestataire is None and description is None:
            if montant is not None:
                total_declare = montant  # ligne de total, close le bloc
            continue

        if prestataire is None and precedent is not None:
            if montant is None:
                # Second véhicule concerné par la dépense précédente.
                precedent.setdefault("vehicules_lies", []).append(description)
                cv = vin_court(description)
                if cv:
                    precedent.setdefault("vins_courts", []).append(cv)
                continue
            prestataire = precedent["prestataire"]

        if montant is None:
            continue

        cv = vin_court(description)
        depense = {
            "ligne": r,
            "prestataire": prestataire,
            "description": description,
            "montant": montant,
            "vins_courts": [cv] if cv else [],
            "vehicules_lies": [description] if cv else [],
        }
        depenses.append(depense)
        precedent = depense

    # ── Bloc 2 : synthèse ───────────────────────────────────────────────────
    if ligne_synthese:
        rubrique = None
        for r in range(ligne_synthese + 1, ws.max_row + 1):
            a = norm(ws.cell(row=r, column=1).value)
            description = txt(ws.cell(row=r, column=2).value)
            montant = nombre(ws.cell(row=r, column=3).value)
            if a in ("RECETTES", "CHARGES", "SOLDE ACTUEL"):
                rubrique = a
            if montant is None:
                continue
            if rubrique == "SOLDE ACTUEL":
                synthese["solde_final"] = montant
            elif rubrique == "RECETTES":
                # « Somme restant le JJ/MM/AAAA » est le report de la veille,
                # pas un encaissement : le confondre doublerait la trésorerie.
                if description and "SOMME RESTANT" in norm(description):
                    synthese["solde_reporte"] = montant
                else:
                    synthese["encaissements"].append(
                        {"description": description, "montant": montant}
                    )

    return {
        "feuille": ws.title,
        "date": date,
        "depenses": depenses,
        "total_declare": total_declare,
        "synthese": synthese,
    }


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    racine = Path(sys.argv[1])
    sortie = Path(sys.argv[2])

    classeur = None
    for f in racine.glob("*.xlsx"):
        if "PZNDE" in norm(f.name) or "DEPENSE" in norm(f.name) or "HBEDOMAIRE" in norm(f.name):
            classeur = f
            break
    if classeur is None:
        sys.exit(f"Registre de caisse introuvable dans {racine}")

    wb = openpyxl.load_workbook(classeur, data_only=True)
    journees = []
    ignorees = []
    for ws in wb.worksheets:
        j = extraire_journee(ws)
        if j:
            journees.append(j)
        else:
            ignorees.append(ws.title)

    journees.sort(key=lambda j: j["date"])

    tampon = {
        "source": str(classeur),
        "feuilles_ignorees": ignorees,
        "journees": journees,
    }
    sortie.parent.mkdir(parents=True, exist_ok=True)
    io.open(sortie, "w", encoding="utf-8").write(
        json.dumps(tampon, ensure_ascii=False, indent=2)
    )

    nb_dep = sum(len(j["depenses"]) for j in journees)
    total = sum(d["montant"] for j in journees for d in j["depenses"])
    encaisse = sum(e["montant"] for j in journees for e in j["synthese"]["encaissements"])
    print(f"Zone tampon ecrite : {sortie}")
    print(f"  {len(journees)} journees du {journees[0]['date']} au {journees[-1]['date']}")
    print(f"  {nb_dep} depenses  {int(total):,} FCFA".replace(",", " "))
    print(f"  encaissements     {int(encaisse):,} FCFA".replace(",", " "))
    print(f"  solde reporte initial {journees[0]['synthese']['solde_reporte']}")
    print(f"  solde final declare   {journees[-1]['synthese']['solde_final']}")
    if ignorees:
        print(f"  feuilles ignorees : {', '.join(ignorees)}")


if __name__ == "__main__":
    main()
