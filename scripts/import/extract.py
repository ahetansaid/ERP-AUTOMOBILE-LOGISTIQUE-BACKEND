"""
Extraction des classeurs vers une zone tampon JSON.

Premier des trois temps de la reprise :

    extract.py  →  tampon.json  →  report.js  →  load.js

Rien n'est écrit en base ici. Le JSON produit EST la zone tampon : lisible,
comparable, corrigeable à la main. C'est ce qui permet d'arbitrer les anomalies
avant qu'une seule ligne ne parte en production.

    python scripts/import/extract.py "D:/Documents/Park auto" scripts/import/tampon.json

Les classeurs ne sont pas structurellement identiques : le bloc « réparation »
commence en colonne N sur certaines feuilles, O sur d'autres, et une feuille n'a
pas de bloc de répartition du tout. L'extraction s'adapte plutôt que de supposer.
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


def sans_accent(s):
    return "".join(
        c for c in unicodedata.normalize("NFD", str(s or "")) if unicodedata.category(c) != "Mn"
    )


def trouver(ws, motif, colonne_max=None):
    """Localise la première cellule dont le texte contient le motif."""
    m = motif.upper()
    for row in ws.iter_rows(max_row=ws.max_row, max_col=colonne_max or ws.max_column):
        for c in row:
            if isinstance(c.value, str) and m in sans_accent(c.value).upper():
                return c
    return None


def extraire_conteneur(ws):
    """En-tête : référence physique du conteneur et date éventuelle."""
    titre = txt(ws.cell(row=1, column=1).value) or ""
    ref = re.sub(r"INVENTAIRE\s+CONTENEUR", "", titre, flags=re.I).strip()
    date = None
    m = re.search(r"(\d{1,2})[/.](\d{1,2})[/.](20\d{2})", ref)
    if m:
        date = f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
        ref = ref[: m.start()].strip()
    ref = re.sub(r"\s+", " ", ref.split("Arriv")[0]).strip()
    return {"reference": ref or None, "date": date}


def extraire_frais(ws, wf):
    """
    Bloc du haut : prix d'achat, transport interne et fret en devise, avec le
    taux appliqué. Le taux est lu DANS la formule — c'est là qu'il vit, et c'est
    ce qui a permis de démontrer les incohérences.
    """
    lignes = []
    for r in range(3, 9):
        vin = txt(ws.cell(row=r, column=4).value)
        if not vin or len(vin) < 10:
            continue
        formule = wf.cell(row=r, column=8).value
        taux = None
        if isinstance(formule, str) and formule.startswith("="):
            t = re.findall(r"\*\s*(\d{3,4})", formule)
            if t:
                taux = int(t[0])
        lignes.append(
            {
                "ligne": r,
                "vehicule": txt(ws.cell(row=r, column=2).value),
                "annee": ws.cell(row=r, column=3).value,
                "vin": vin,
                "achat_devise": nombre(ws.cell(row=r, column=5).value),
                "transport_devise": nombre(ws.cell(row=r, column=6).value),
                "fret_devise": nombre(ws.cell(row=r, column=7).value),
                "taux_bloc_cout": taux,
            }
        )
    return lignes


def extraire_manutention(ws):
    """Bloc du milieu : dépotage, main d'œuvre et frais connexes, déjà en FCFA."""
    ancre = trouver(ws, "DETAIL FRAIS MANUTENTION", colonne_max=4)
    if not ancre:
        return {}
    par_vin = {}
    for r in range(ancre.row + 2, ancre.row + 10):
        vin = txt(ws.cell(row=r, column=4).value)
        if not vin or len(vin) < 10:
            continue
        par_vin[vin] = {
            "depotage": nombre(ws.cell(row=r, column=5).value),
            "main_oeuvre": nombre(ws.cell(row=r, column=6).value),
            "frais_connexe": nombre(ws.cell(row=r, column=7).value),
        }
    return par_vin


def extraire_repartition(ws, wf):
    """
    Bloc du bas : c'est lui qui a alimenté les coûts utilisés jusqu'ici. On en
    retient le coût total, le prix de vente et le TAUX, qui diffère parfois de
    celui du bloc du haut — l'incohérence à signaler.
    """
    ancre = trouver(ws, "partition des couts", colonne_max=4)
    if not ancre:
        return {}
    par_vin = {}
    for r in range(ancre.row + 2, ancre.row + 10):
        vin = txt(ws.cell(row=r, column=4).value)
        if not vin or len(vin) < 10:
            continue
        taux = None
        f = wf.cell(row=r, column=5).value
        if isinstance(f, str) and f.startswith("="):
            t = re.findall(r"\*\s*(\d{3,4})", f)
            if t:
                taux = int(t[0])
        par_vin[vin] = {
            "cout_total": nombre(ws.cell(row=r, column=10).value),
            "reparation": nombre(ws.cell(row=r, column=8).value),
            "imv": nombre(ws.cell(row=r, column=9).value),
            "prix_vente": nombre(ws.cell(row=r, column=12).value),
            "taux_bloc_repartition": taux,
        }
    return par_vin


def extraire_interventions(ws):
    """
    Bloc « RÉPARATION & MAINTENANCE ». Sa colonne de départ varie selon les
    feuilles : on la localise au lieu de la supposer.
    """
    # On vise « MAINTENANCE » et non « RÉPARATION » : ce dernier mot apparaît
    # aussi en en-tête de colonne du bloc de répartition, plus haut dans la
    # feuille, et l'ancre tombait dessus.
    ancre = trouver(ws, "MAINTENANCE")
    if not ancre:
        return []
    c_veh, c_desc, c_presta, c_cout = (
        ancre.column,
        ancre.column + 3,
        ancre.column + 4,
        ancre.column + 5,
    )
    lignes = []
    vin_courant = None
    veh_courant = None
    for r in range(ancre.row + 1, ws.max_row + 1):
        libelle = txt(ws.cell(row=r, column=c_veh).value)
        if libelle and "ous-total" not in libelle:
            veh_courant = libelle
            chassis = txt(ws.cell(row=r, column=c_veh + 2).value)
            if chassis and len(chassis) >= 10:
                vin_courant = chassis
        montant = nombre(ws.cell(row=r, column=c_cout).value)
        presta = txt(ws.cell(row=r, column=c_presta).value)
        if montant and presta and libelle != "Sous-total":
            atelier = None
            u = sans_accent(presta).upper()
            if "EURO" in u:
                atelier = "EURO"
            elif "USA" in u:
                atelier = "USA"
            lignes.append(
                {
                    "vin": vin_courant,
                    "vehicule": veh_courant,
                    "description": txt(ws.cell(row=r, column=c_desc).value),
                    "prestataire": presta,
                    "atelier": atelier,
                    "montant": montant,
                }
            )
    return lignes


def extraire_pieces(chemin):
    """Classeur des pièces détachées, second registre parallèle."""
    if not chemin.exists():
        return {}
    wb = openpyxl.load_workbook(chemin, data_only=True)
    par_feuille = {}
    for ws in wb.worksheets:
        total = 0
        lignes = []
        for r in range(3, ws.max_row + 1):
            lbl = txt(ws.cell(row=r, column=1).value)
            montant = nombre(ws.cell(row=r, column=5).value)
            if montant and not (lbl and "otal" in lbl):
                total += montant
                lignes.append(
                    {
                        "vin": txt(ws.cell(row=r, column=3).value),
                        "piece": txt(ws.cell(row=r, column=4).value),
                        "montant": montant,
                    }
                )
        if total:
            par_feuille[ws.title] = {"total": total, "lignes": lignes}
    return par_feuille


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    racine = Path(sys.argv[1])
    sortie = Path(sys.argv[2])

    costing = racine / "COSTING_Import_Auto" / "Achat, Fret et Manutention.xlsx"
    pieces = racine / "COSTING_Import_Auto" / "Achat de Pièces_COT.xlsx"
    if not costing.exists():
        sys.exit(f"Introuvable : {costing}")

    wv = openpyxl.load_workbook(costing, data_only=True)
    wf = openpyxl.load_workbook(costing, data_only=False)

    conteneurs = []
    for ws in wv.worksheets:
        wsf = wf[ws.title]
        frais = extraire_frais(ws, wsf)
        if not frais:
            continue
        manut = extraire_manutention(ws)
        repart = extraire_repartition(ws, wsf)
        interventions = extraire_interventions(ws)

        vehicules = []
        for f in frais:
            vin = f["vin"]
            r = repart.get(vin, {})
            m = manut.get(vin, {})
            vehicules.append(
                {
                    **f,
                    **m,
                    **r,
                    # L'atelier est déduit des interventions du véhicule : il est
                    # porté par le véhicule, pas par le nom du prestataire.
                    "atelier": next(
                        (i["atelier"] for i in interventions if i["vin"] == vin and i["atelier"]),
                        None,
                    ),
                }
            )

        conteneurs.append(
            {
                "feuille": ws.title,
                **extraire_conteneur(ws),
                "vehicules": vehicules,
                "interventions": interventions,
            }
        )

    tampon = {
        "source": str(costing),
        "conteneurs": conteneurs,
        "pieces_detachees": extraire_pieces(pieces),
    }

    sortie.parent.mkdir(parents=True, exist_ok=True)
    io.open(sortie, "w", encoding="utf-8").write(
        json.dumps(tampon, ensure_ascii=False, indent=2)
    )

    nb_veh = sum(len(c["vehicules"]) for c in conteneurs)
    nb_int = sum(len(c["interventions"]) for c in conteneurs)
    print(f"Zone tampon écrite : {sortie}")
    print(f"  {len(conteneurs)} conteneurs · {nb_veh} véhicules · {nb_int} interventions")
    print(f"  {len(tampon['pieces_detachees'])} feuilles de pièces détachées")


if __name__ == "__main__":
    main()
