"""
Extraction des classeurs vers une zone tampon JSON.

Premier des trois temps de la reprise :

    extract.py  →  tampon.json  →  report.js  →  load.js

Rien n'est écrit en base ici. Le JSON produit EST la zone tampon : lisible,
comparable, corrigeable à la main. C'est ce qui permet d'arbitrer les anomalies
avant qu'une seule ligne ne parte en production.

    python scripts/import/extract.py "D:/Documents/Park auto" scripts/import/tampon.json

LES COLONNES NE SONT PAS AUX MÊMES ENDROITS D'UNE FEUILLE À L'AUTRE.

Une première version lisait des positions fixes. Elle se trompait sur six
feuilles sur quinze :

  · HLCUBSC260226117 intercale « Com USD » entre l'achat et le transport, et
    décale tout le bloc de répartition d'une colonne — le « coût total » lu
    était en réalité l'IMV, ce qui produisait des totaux à 48 000 F ;
  · HLCUBSC260405510 et HLCUMTR260526189 placent « Com USD » APRÈS le fret ;
  · HLCUMTR260431552 n'a pas de colonne de transport du tout ;
  · MEDURS330427 la nomme « Fr TR USD ».

Chaque bloc est donc localisé par sa ligne d'en-tête, et chaque colonne par son
libellé. Une colonne absente donne une valeur nulle — jamais la valeur de la
colonne voisine.
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


def norm(s):
    """Libellé comparable : sans accent, majuscules, espaces resserrés."""
    return re.sub(r"\s+", " ", sans_accent(s).upper()).strip()


def est_vin(v):
    s = txt(v)
    return s if s and len(s) >= 10 else None


# ── Repérage des blocs ──────────────────────────────────────────────────────

# Chaque feuille contient trois tableaux empilés, tous introduits par une ligne
# d'en-tête où la quatrième colonne s'appelle « VIN ».
def lignes_entete(ws):
    lignes = []
    for r in range(1, min(ws.max_row, 60) + 1):
        for c in ws[r]:
            if isinstance(c.value, str) and norm(c.value) in ("VIN", "CHASSIS", "N CHASSIS"):
                lignes.append(r)
                break
    return lignes


def entetes(ws, ligne):
    """{numéro de colonne: libellé normalisé} pour une ligne d'en-tête."""
    return {
        c.column: norm(c.value)
        for c in ws[ligne]
        if isinstance(c.value, str) and c.value.strip()
    }


def colonne(entetes_bloc, motif):
    """Numéro de la colonne dont le libellé correspond, ou None."""
    for col, libelle in sorted(entetes_bloc.items()):
        if re.search(motif, libelle):
            return col
    return None


def lire_lignes(ws, entete, col_vin, max_lignes=12):
    """Lignes de données sous un en-tête, jusqu'à épuisement des châssis."""
    lignes = []
    vides = 0
    for r in range(entete + 1, min(entete + 1 + max_lignes, ws.max_row + 1)):
        vin = est_vin(ws.cell(row=r, column=col_vin).value)
        if not vin:
            vides += 1
            if vides >= 2:
                break
            continue
        vides = 0
        lignes.append((r, vin))
    return lignes


def taux_dans_formule(wsf, ligne, col):
    """
    Le taux de change vit dans la formule, pas dans une cellule dédiée.
    C'est ce qui a permis de démontrer que deux blocs d'une même feuille
    convertissent parfois le même véhicule à deux taux différents.
    """
    if not col:
        return None
    f = wsf.cell(row=ligne, column=col).value
    if isinstance(f, str) and f.startswith("="):
        t = re.findall(r"\*\s*(\d{3,4})", f)
        if t:
            return int(t[0])
    return None


# ── Les trois blocs ─────────────────────────────────────────────────────────


def bloc_frais(ws, wsf, entete):
    """
    Bloc du haut : achat, transport interne, fret et commission en devise.

    Le nombre de composants varie selon la feuille — c'est pourquoi ils sont
    cherchés par libellé. « Fret » est testé avant « TR » : la feuille
    MEDURS330427 nomme sa colonne « Fr TR USD », et un test trop large sur
    « FR » la classerait en fret.
    """
    e = entetes(ws, entete)
    col_vin = colonne(e, r"^(VIN|CHASSIS|N CHASSIS)$")
    cols = {
        "achat_devise": colonne(e, r"\bACHAT\b"),
        "fret_devise": colonne(e, r"\bFRET\b"),
        "transport_devise": colonne(e, r"\bTR\b|\bTRANSPORT\b"),
        "commission_devise": colonne(e, r"\bCOM\b|\bCOMMISSION\b"),
    }
    col_total = colonne(e, r"COUT LOGISTIQUE")
    col_veh = colonne(e, r"VEHICULE")
    col_annee = colonne(e, r"ANNEE")

    lignes = []
    for r, vin in lire_lignes(ws, entete, col_vin):
        ligne = {
            "ligne": r,
            "vehicule": txt(ws.cell(row=r, column=col_veh).value) if col_veh else None,
            "annee": ws.cell(row=r, column=col_annee).value if col_annee else None,
            "vin": vin,
            "taux_bloc_cout": taux_dans_formule(wsf, r, col_total),
        }
        for champ, col in cols.items():
            ligne[champ] = nombre(ws.cell(row=r, column=col).value) if col else None
        lignes.append(ligne)
    return lignes


def bloc_manutention(ws, entete):
    """Bloc du milieu : dépotage, main d'œuvre, frais connexes — déjà en FCFA."""
    e = entetes(ws, entete)
    col_vin = colonne(e, r"^(VIN|CHASSIS|N CHASSIS)$")
    cols = {
        "depotage": colonne(e, r"DEPOTAGE"),
        "main_oeuvre": colonne(e, r"\bMAIN\b"),
        "frais_connexe": colonne(e, r"CONNEXE"),
    }
    par_vin = {}
    for r, vin in lire_lignes(ws, entete, col_vin):
        par_vin[vin] = {
            champ: (nombre(ws.cell(row=r, column=col).value) if col else None)
            for champ, col in cols.items()
        }
    return par_vin


def bloc_repartition(ws, wsf, entete):
    """
    Bloc du bas : c'est lui qui a alimenté les coûts utilisés jusqu'ici.

    On en retient le coût total, le prix de vente et le TAUX, qui diffère
    parfois de celui du bloc du haut — l'incohérence à signaler.
    """
    e = entetes(ws, entete)
    col_vin = colonne(e, r"^(VIN|CHASSIS|N CHASSIS)$")
    cols = {
        "cout_total": colonne(e, r"COUT TOTAL"),
        "reparation": colonne(e, r"REPARATION"),
        "imv": colonne(e, r"\bIMV\b"),
        "prix_vente": colonne(e, r"PRIX DE VENTE"),
        "marge_classeur": colonne(e, r"\bMARGE\b"),
        "manutention_repartie": colonne(e, r"MANUTENTION"),
        "logistique_repartie": colonne(e, r"LOGISTIQUE"),
    }
    col_achat = colonne(e, r"ACHAT")

    par_vin = {}
    for r, vin in lire_lignes(ws, entete, col_vin):
        d = {
            champ: (nombre(ws.cell(row=r, column=col).value) if col else None)
            for champ, col in cols.items()
        }
        d["taux_bloc_repartition"] = taux_dans_formule(wsf, r, col_achat)
        par_vin[vin] = d
    return par_vin


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


def extraire_interventions(ws):
    """
    Bloc « RÉPARATION & MAINTENANCE ». Sa colonne de départ varie selon les
    feuilles : on la localise au lieu de la supposer.
    """
    # On vise « MAINTENANCE » et non « RÉPARATION » : ce dernier mot apparaît
    # aussi en en-tête de colonne du bloc de répartition, plus haut dans la
    # feuille, et l'ancre tombait dessus.
    ancre = None
    for row in ws.iter_rows(max_row=ws.max_row):
        for c in row:
            if isinstance(c.value, str) and "MAINTENANCE" in norm(c.value):
                ancre = c
                break
        if ancre:
            break
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
            chassis = est_vin(ws.cell(row=r, column=c_veh + 2).value)
            if chassis:
                vin_courant = chassis
        montant = nombre(ws.cell(row=r, column=c_cout).value)
        presta = txt(ws.cell(row=r, column=c_presta).value)
        if montant and presta and libelle != "Sous-total":
            atelier = None
            u = norm(presta)
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


def extraire_feuille(ws, wsf):
    """
    Les trois blocs d'une feuille, reconnus par ce qu'ils contiennent et non
    par leur rang : une feuille peut n'avoir aucun bloc de répartition.
    """
    entete_frais = entete_manut = entete_repart = None
    for ligne in lignes_entete(ws):
        e = entetes(ws, ligne)
        libelles = " | ".join(e.values())
        if "DEPOTAGE" in libelles:
            entete_manut = ligne
        elif "COUT TOTAL" in libelles:
            entete_repart = ligne
        elif entete_frais is None:
            entete_frais = ligne

    if entete_frais is None:
        return None

    frais = bloc_frais(ws, wsf, entete_frais)
    if not frais:
        return None
    manut = bloc_manutention(ws, entete_manut) if entete_manut else {}
    repart = bloc_repartition(ws, wsf, entete_repart) if entete_repart else {}
    interventions = extraire_interventions(ws)

    vehicules = []
    for f in frais:
        vin = f["vin"]
        vehicules.append(
            {
                **f,
                **manut.get(vin, {}),
                **repart.get(vin, {}),
                # L'atelier est déduit des interventions du véhicule : il est
                # porté par le véhicule, pas par le nom du prestataire.
                "atelier": next(
                    (i["atelier"] for i in interventions if i["vin"] == vin and i["atelier"]),
                    None,
                ),
            }
        )

    return {
        "feuille": ws.title,
        **extraire_conteneur(ws),
        "blocs": {
            "frais": entete_frais,
            "manutention": entete_manut,
            "repartition": entete_repart,
        },
        "vehicules": vehicules,
        "interventions": interventions,
    }


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
    ignorees = []
    for ws in wv.worksheets:
        feuille = extraire_feuille(ws, wf[ws.title])
        if feuille:
            conteneurs.append(feuille)
        else:
            ignorees.append(ws.title)

    tampon = {
        "source": str(costing),
        "feuilles_ignorees": ignorees,
        "conteneurs": conteneurs,
        "pieces_detachees": extraire_pieces(pieces),
    }

    sortie.parent.mkdir(parents=True, exist_ok=True)
    io.open(sortie, "w", encoding="utf-8").write(
        json.dumps(tampon, ensure_ascii=False, indent=2)
    )

    nb_veh = sum(len(c["vehicules"]) for c in conteneurs)
    nb_int = sum(len(c["interventions"]) for c in conteneurs)
    sans_repart = [c["feuille"] for c in conteneurs if not c["blocs"]["repartition"]]
    print(f"Zone tampon ecrite : {sortie}")
    print(f"  {len(conteneurs)} conteneurs · {nb_veh} vehicules · {nb_int} interventions")
    print(f"  {len(tampon['pieces_detachees'])} feuilles de pieces detachees")
    if sans_repart:
        print(f"  sans bloc de repartition : {', '.join(sans_repart)}")
    if ignorees:
        print(f"  feuilles ignorees : {', '.join(ignorees)}")


if __name__ == "__main__":
    main()
