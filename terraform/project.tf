# =============================================================================
# GCP PROJECT — dédié, facturation isolée (pattern ghota-<produit>-prod)
# =============================================================================

resource "google_project" "app" {
  provider        = google.bootstrap
  project_id      = var.project_id
  name            = var.project_name
  billing_account = var.billing_account
  folder_id       = var.folder_id

  labels = {
    managed_by  = "terraform"
    platform    = "ghota"
    application = "devine"
    environment = "production"
  }

  lifecycle {
    prevent_destroy = true
  }
}
