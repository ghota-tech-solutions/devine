# Mac ou Nuage ?

**[devine.ghotatechsolutions.com](https://devine.ghotatechsolutions.com)**

Un jeu : tu poses une question, **deux IA répondent en même temps**, côte à
côte. L'une est **Qwen 3.8 Flash Next**, en local sur un MacBook Pro M5 Max
posé à Lyon (servi par oMLX), l'autre **Gemini 3.8 Flash**, dans le cloud de
Google (Vertex AI). Les réponses s'appellent « IA A » et « IA B »,
tirées au sort à chaque manche : **à toi de deviner laquelle est le Mac**.
La révélation affiche les débits mesurés des deux côtés.

## Architecture

```
Navigateur ──SSE──▶ Cloud Run (Next.js 16 / Bun)
                      ├──▶ Vertex AI (Gemini 3.8 Flash, stream)
                      └──▶ oMLX sur le Mac (Qwen 3.8 Flash Next, API OpenAI-compatible)
                      └──▶ Firestore (manches, statistiques)
```

- **File d'attente** : le Mac ne sert qu'une manche à la fois, sinon deux
  manches se partagent le GPU et la mesure ne veut plus rien dire. Le visiteur
  pose sa question tout de suite ; elle part à son tour, et sa position
  s'affiche en direct. La file vit en mémoire du processus, d'où
  `max_instance_count = 1` sur Cloud Run.
- **Mesures honnêtes** : les deux débits sont mesurés côté serveur, en tokens
  réels, sur la fenêtre de décode (premier → dernier token). Le délai avant le
  premier token inclut le trajet réseau de chaque côté. Affichés tels quels.
- **Placement tiré au sort** : le Mac est à gauche ou à droite selon la
  manche. Avant le vote, ni l'interface ni l'API ne le révèlent : le navigateur
  reçoit les pistes rangées par position (`src/application/usecases/publicRound.ts`),
  le côté du Mac n'arrive qu'avec la révélation. Les deux vitesses en direct
  sont estimées de la même façon.
- **Contingent** : `MAX_ROUNDS_PER_DAY`, limite par IP (`PER_IP_PER_WINDOW`
  sur `WINDOW_MS`), budget Terraform à 10 €/mois avec alerte à 50 %.
- **Secrets** : la clé oMLX passe par Secret Manager, jamais par le navigateur
  ni par git.

## Développer

```bash
bun install
bun test                  # Clean Architecture : domaine pur + use cases + fakes en mémoire
cp .env.example .env      # puis ajuster LOCAL_MODEL / OMLX_URL
MEMORY_STORE=true bun dev # site complet sans GCP (réponse « nuage » simulée sans Vertex)
```

`LOCAL_MODEL` est l'alias servi par oMLX (`~/.omlx/model_settings.json`). La
clé API oMLX est lue dans `OMLX_API_KEY` ou, à défaut, `~/.omlx/settings.json`.

## Déployer

L'image se construit sur Cloud Build (amd64 natif, pas de build croisé depuis
un Mac ARM) puis Terraform met à jour le service :

```bash
IMAGE=europe-west1-docker.pkg.dev/<projet>/devine/devine:$(date +%Y%m%d-%H%M)
gcloud builds submit --project <projet> --config cloudbuild.yaml --substitutions _IMAGE=$IMAGE
cd terraform
terraform init
terraform apply -var container_image=$IMAGE
```

Variables Terraform attendues (fichier `*.tfvars` jamais commité, ou
`TF_VAR_*`) : voir `terraform/variables.tf`, notamment `billing_account`,
`omlx_url`, `local_model` et `omlx_api_key`. L'état Terraform vit dans un
bucket GCS (`terraform/main.tf`).

## Conventions

Clean Architecture (`domain` ne dépend de rien, `application` ne connaît que
`domain`, `src/main/builder.ts` câble le tout), tests en `// GIVEN // WHEN // THEN`,
fakes en mémoire plutôt que mocks de bibliothèque. Le cycle de vie d'une manche
est une machine à états pure (`src/domain/states/roundStateMachine.ts`),
testée table par table.

## Licence

[MIT](LICENSE) © 2026 Ghota Tech Solutions
