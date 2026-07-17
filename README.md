# Remix Banger GPT Action — GitHub + Render

Dépôt prêt à pousser sur GitHub puis à déployer sur Render. Il expose l'opération OpenAPI `startProfessionalRemix`, un endpoint de suivi et un schéma OpenAPI automatiquement adapté au domaine Render.

## Déploiement en 6 étapes

1. Créez un dépôt GitHub vide.
2. Décompressez ce ZIP et poussez tous les fichiers à la racine du dépôt :

```bash
./scripts/push-to-github.sh https://github.com/VOTRE-COMPTE/VOTRE-DEPOT.git
```

Le script initialise Git, crée le commit, configure `origin` et pousse la branche `main`. Les commandes Git manuelles restent possibles si vous préférez.

3. Dans Render, choisissez **New > Blueprint**, connectez GitHub et sélectionnez ce dépôt. Render détecte `render.yaml`. Ce fichier utilise l'instance gratuite pour les essais. Pour un service toujours actif, remplacez-le avant le push par `render.production.yaml`.
4. Attendez que le service soit vert, puis ouvrez son URL `https://...onrender.com`.
5. Dans **Environment**, copiez la valeur générée de `GPT_ACTION_API_KEY`.
6. Ouvrez `https://...onrender.com/openapi.yaml` et copiez le YAML dans l'Action du GPT.

## Configuration de l'Action GPT

Dans l'éditeur du GPT :

- Authentification : **API Key**.
- Type : en-tête personnalisé.
- Nom : `X-API-Key`.
- Valeur : `GPT_ACTION_API_KEY` copiée depuis Render.
- Schéma : contenu de `/openapi.yaml`.
- Instructions : contenu de `instructions-gpt.md`.
- Politique de confidentialité : `https://...onrender.com/privacy-policy` après personnalisation du fichier.

Testez dans cet ordre :

1. `getRemixApiHealth`
2. `startProfessionalRemix`
3. `getProfessionalRemixStatus`

## Gratuit ou production

`render.yaml` utilise `plan: free`. Une instance gratuite Render s'arrête après une période d'inactivité et son redémarrage peut dépasser le délai toléré par une Action GPT. Pour un usage fiable, renommez `render.production.yaml` en `render.yaml` avant le premier déploiement ; cette variante utilise `plan: starter`.

## Mode de test fourni

Le Blueprint démarre avec `MOCK_MODE=true`. Il permet de tester toute l'intégration GPT sans moteur audio : après quelques secondes, l'URL source est renvoyée comme résultat.

Pour brancher le moteur réel, ajoutez dans Render > Environment :

```dotenv
MOCK_MODE=false
REMIX_PROVIDER_START_URL=https://api.votre-fournisseur.example/remixes
REMIX_PROVIDER_STATUS_URL_TEMPLATE=https://api.votre-fournisseur.example/remixes/{jobId}
REMIX_PROVIDER_API_KEY=votre-secret
REMIX_PROVIDER_AUTH_HEADER=Authorization
REMIX_PROVIDER_AUTH_SCHEME=Bearer
REMIX_PROVIDER_MODE=json-url
```

Deux modes sont disponibles :

- `json-url` : transmet l'URL temporaire OpenAI au fournisseur.
- `multipart` : télécharge l'audio puis l'envoie dans le champ multipart `audio`.

Adaptez seulement `mapStartResponse`, `mapStatusResponse` et éventuellement `startWithProvider` dans `server.mjs` si le contrat du fournisseur utilise d'autres champs.

## Architecture et persistance

En mode fournisseur réel, le service est stateless : l'identifiant du fournisseur est encodé dans le `jobId`. Le suivi résiste donc aux redémarrages Render sans base de données. Le mode mock conserve ses tâches en mémoire et sert uniquement aux tests.

## Routes utiles

- `/` : informations du service.
- `/health` : health check Render.
- `/openapi.yaml` : schéma avec le domaine courant.
- `/privacy-policy` : politique de confidentialité.
- `POST /v1/remixes/professional` : démarrage.
- `GET /v1/remixes/{jobId}` : suivi.

## Développement local

```bash
cp .env.example .env
npm ci
npm run check
npm test
npm start
```

Puis ouvrez `http://localhost:3000`.

Pour générer un YAML statique :

```bash
PUBLIC_BASE_URL=https://votre-service.onrender.com npm run openapi
```

Le fichier créé est `openapi.generated.yaml`.

## Sécurité

- Ne commitez jamais `.env` ni les clés API.
- Par défaut, les fichiers entrants doivent venir de `files.oaiusercontent.com`.
- `ALLOW_ANY_FILE_URL=true` désactive cette protection et n'est pas recommandé en production.
- Le téléchargement multipart est limité à 50 Mo par défaut.
- Personnalisez `privacy-policy.html` avant toute publication publique.
