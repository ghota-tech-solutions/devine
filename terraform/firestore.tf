# =============================================================================
# FIRESTORE — classements, manches, lien du Mac (mode Datastore désactivé)
# =============================================================================

resource "google_firestore_database" "main" {
  project     = var.project_id
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"

  depends_on = [google_project_service.apis]
}

# Purge : les manches et leurs prompts vivent 30 jours, pas plus.
resource "google_firestore_field" "rounds_ttl" {
  project    = var.project_id
  database   = google_firestore_database.main.name
  collection = "rounds"
  field      = "createdAt"

  ttl_config {
    expiration_offset = "2592000s" # 30 jours après createdAt
  }

  depends_on = [google_firestore_database.main]
}
