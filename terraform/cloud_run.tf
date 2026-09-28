# =============================================================================
# CLOUD RUN SERVICE — devine
# =============================================================================

resource "google_service_account" "devine_sa" {
  account_id   = "devine-sa"
  display_name = "Devine Cloud Run Service Account"
  project      = var.project_id

  depends_on = [google_project_service.apis]
}

resource "google_project_iam_member" "devine_ar_reader" {
  project = var.project_id
  role    = "roles/artifactregistry.reader"
  member  = "serviceAccount:${google_service_account.devine_sa.email}"
}

# Gemini Flash sur Vertex via le compte de service — pas de clé en dur.
resource "google_project_iam_member" "devine_vertex_user" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.devine_sa.email}"
}

resource "google_project_iam_member" "devine_datastore_user" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.devine_sa.email}"
}

# Clé API oMLX — le serveur Next appelle le Mac en direct, la clé ne
# descend jamais dans le navigateur. Secret Manager plutôt qu'une env en
# clair (une env se lit dans la description du service et l'audit).
resource "google_secret_manager_secret" "omlx_api_key" {
  secret_id = "devine-omlx-api-key"
  project   = var.project_id

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "omlx_api_key_version" {
  secret      = google_secret_manager_secret.omlx_api_key.id
  secret_data = var.omlx_api_key
}

resource "google_secret_manager_secret_iam_member" "omlx_api_key_access" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.omlx_api_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.devine_sa.email}"
}

resource "google_cloud_run_v2_service" "devine" {
  name     = "devine"
  location = var.region
  project  = var.project_id
  ingress  = "INGRESS_TRAFFIC_ALL"
  # Public sans binding allUsers (même pattern que RoastMyPic) : la politique
  # d'organisation iam.allowedPolicyMemberDomains refuse les bindings publics.
  invoker_iam_disabled = true

  template {
    session_affinity = false

    # Une seule instance : la file d'attente des manches vit en mémoire du
    # processus (src/application/queue/roundQueue.ts). Plusieurs instances =
    # plusieurs files, et deux manches se partageraient le GPU du Mac.
    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }

    service_account = google_service_account.devine_sa.email

    containers {
      image = var.container_image

      env {
        name  = "GCLOUD_PROJECT"
        value = var.project_id
      }
      env {
        name  = "VERTEX_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "VERTEX_LOCATION"
        value = "global"
      }
      env {
        name  = "VERTEX_MODEL"
        value = var.vertex_model
      }
      env {
        name  = "MAX_ROUNDS_PER_DAY"
        value = tostring(var.max_rounds_per_day)
      }
      env {
        name  = "PER_IP_PER_WINDOW"
        value = tostring(var.per_ip_per_window)
      }
      # Cloud Run relaie la piste Mac en appelant l'oMLX exposé derrière la
      # box (redirection de port). L'IP n'apparaît jamais côté navigateur.
      env {
        name  = "OMLX_URL"
        value = var.omlx_url
      }
      env {
        name  = "LOCAL_MODEL"
        value = var.local_model
      }
      env {
        name = "OMLX_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.omlx_api_key.secret_id
            version = "latest"
          }
        }
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }
  }

}

# Site public : l'accès anonyme se fait par invoker_iam_disabled sur le
# service (ci-dessus), pas par un binding allUsers — la politique
# d'organisation iam.allowedPolicyMemberDomains bloque ces bindings.

# =============================================================================
# DOMAIN MAPPING — devine.ghotatechsolutions.com
# =============================================================================
# Le NS de ghotatechsolutions.com pointe chez le registrar (ns-cloud-*.googledomains.com),
# pas dans une zone Cloud DNS : la CNAME `devine` → ghs.googlehosted.com et, si
# besoin, le TXT de vérification se posent dans la console du registrar. Suivi :
#   gcloud run domain-mappings describe devine.ghotatechsolutions.com
# create_domain_mapping=0 tant que la vérification TXT n'est pas posée chez le
# registrar (googledomains) — le site sert déjà sur son URL run.app.
resource "google_cloud_run_domain_mapping" "devine" {
  count = var.create_domain_mapping ? 1 : 0

  name = "devine.${var.domain}"
  # Même région que le service (comme RoastMyPic) — « global » renvoie 404
  # sur ce projet.
  location = var.region
  project  = var.project_id

  metadata {
    namespace = var.project_id
  }

  spec {
    route_name = google_cloud_run_v2_service.devine.name
  }

  depends_on = [google_cloud_run_v2_service.devine]
}
