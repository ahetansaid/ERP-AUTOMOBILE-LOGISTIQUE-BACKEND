# POST /receipts — Ce que le frontend doit envoyer

Pour éviter le **400 Bad Request**, le formulaire « Nouveau reçu » doit envoyer un body JSON **exactement** comme ci‑dessous.

---

## 1. Reçu lié à une facture (vente)

**Obligatoire :** indiquer la **facture** et le **montant**. Méthode et date ont des valeurs par défaut côté backend.

### Champs à envoyer

| Champ | Clé(s) acceptées | Type | Obligatoire | Exemple |
|-------|------------------|------|-------------|--------|
| Facture | `invoiceId` ou `invoice_id` | number | **Oui** | `1` |
| Montant | `amount` | number | **Oui** | `150000` |
| Méthode de paiement | `paymentMethod` ou `payment_method` | string | Non (défaut: `"ESPECES"`) | `"VIREMENT"` |
| Date de paiement | `paymentDate` ou `payment_date` | string (YYYY-MM-DD ou ISO) | Non (défaut: aujourd’hui) | `"2026-03-07"` |
| Référence | `reference` | string | Non | `"REF-001"` |

### Exemple de body (reçu facture)

```json
{
  "invoiceId": 1,
  "amount": 150000,
  "paymentMethod": "ESPECES",
  "paymentDate": "2026-03-07",
  "reference": "Virement du 07/03"
}
```

Ou en snake_case (également accepté) :

```json
{
  "invoice_id": 1,
  "amount": 150000,
  "payment_method": "VIREMENT",
  "payment_date": "2026-03-07",
  "reference": "Virement du 07/03"
}
```

---

## 2. Reçu lié à un devis (maintenance / atelier)

**Obligatoire :** indiquer le **devis** et le **montant**. Même règles que ci‑dessus pour méthode et date.

### Champs à envoyer

| Champ | Clé(s) acceptées | Type | Obligatoire | Exemple |
|-------|------------------|------|-------------|--------|
| Devis | `devisId`, `devis_id`, `quoteId` ou `quote_id` | number | **Oui** | `2` |
| Montant | `amount` | number | **Oui** | `75000` |
| Méthode de paiement | `paymentMethod` ou `payment_method` | string | Non (défaut: `"ESPECES"`) | `"ESPECES"` |
| Date de paiement | `paymentDate` ou `payment_date` | string | Non (défaut: aujourd’hui) | `"2026-03-07"` |
| Référence | `reference` | string | Non | — |
| Type de source (optionnel) | `source_type` ou `sourceType` | string | Non | `"DEVIS"` |

**Important :** n’envoyer **ni** `invoiceId` **ni** `invoice_id` pour un reçu devis. Envoyer **uniquement** l’id du devis.

### Exemple de body (reçu devis)

```json
{
  "devisId": 2,
  "amount": 75000,
  "paymentMethod": "ESPECES",
  "paymentDate": "2026-03-07",
  "reference": ""
}
```

Ou avec `source_type` (recommandé si le formulaire gère facture et devis) :

```json
{
  "source_type": "DEVIS",
  "devis_id": 2,
  "amount": 75000,
  "payment_method": "ESPECES",
  "payment_date": "2026-03-07"
}
```

---

## 3. Règles à respecter pour éviter le 400

1. **Un seul type de reçu par requête**  
   Envoyer **soit** `invoiceId` / `invoice_id` **soit** `devisId` / `devis_id`, jamais les deux en même temps.

2. **Montant**  
   Toujours un **nombre** (pas une chaîne) : `amount: 75000` et non `"75000"`. Le backend accepte les deux, mais un nombre est préférable.

3. **Date**  
   Format **YYYY-MM-DD** (ex. `"2026-03-07"`) ou chaîne ISO complète (ex. `"2026-03-07T00:00:00.000Z"`). Le backend tronque au jour.

4. **En-tête**  
   `Content-Type: application/json` et `Authorization: Bearer <accessToken>`.

---

## 4. Exemple d’appel depuis le frontend (reçu devis)

```javascript
const response = await fetch('http://localhost:3001/receipts', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
  },
  body: JSON.stringify({
    devisId: selectedDevisId,   // number, ex. 2
    amount: Number(amount),     // number, ex. 75000
    paymentMethod: paymentMethod || 'ESPECES',
    paymentDate: paymentDate || new Date().toISOString().slice(0, 10), // "2026-03-07"
    reference: reference || '',
  }),
});
```

Si `response.status === 400`, lire `response.json()` : le champ **`message`** indique la cause (ex. « invoiceId ou devisId requis »), et **`field`** indique le champ concerné.

---

## 5. Réponse succès (201)

```json
{
  "id": 1,
  "invoice_id": null,
  "workshop_quote_id": 2,
  "amount": 75000,
  "payment_method": "ESPECES",
  "payment_date": "2026-03-07",
  "reference": null,
  "created_at": "2026-03-07T09:30:00.000Z"
}
```

Pour un reçu facture, `workshop_quote_id` sera `null` et `invoice_id` sera renseigné.
