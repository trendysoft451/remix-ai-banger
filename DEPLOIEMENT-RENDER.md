# Checklist Render et GPT

## Render

- [ ] Dépôt GitHub créé et fichiers poussés à la racine.
- [ ] Blueprint créé depuis le dépôt.
- [ ] Déploiement réussi et `/health` retourne `ok: true`.
- [ ] `GPT_ACTION_API_KEY` copiée depuis Environment.
- [ ] Mode réel configuré seulement lorsque l'API du fournisseur est connue.

## GPT personnalisé

- [ ] Action créée avec authentification API Key.
- [ ] En-tête personnalisé `X-API-Key`.
- [ ] Schéma copié depuis `https://SERVICE.onrender.com/openapi.yaml`.
- [ ] Instructions copiées depuis `instructions-gpt.md`.
- [ ] Test de `getRemixApiHealth` réussi.
- [ ] Test avec un petit MP3 réussi.
- [ ] Politique de confidentialité personnalisée et renseignée si le GPT est publié.
