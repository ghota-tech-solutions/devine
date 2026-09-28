resource "google_artifact_registry_repository" "app" {
  location      = var.region
  repository_id = "devine"
  format        = "DOCKER"
  project       = var.project_id

  depends_on = [google_project_service.apis]

  # Nettoyage des vieux tags : à faire par `cleanup_policies` plus tard si
  # le registre déborde (5 tags gardés suffisent pour un/demo de ce gabarit).
}
