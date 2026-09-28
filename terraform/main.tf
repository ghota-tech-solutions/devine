# =============================================================================
# DEVINE (Mac ou Nuage ?) — TERRAFORM
# =============================================================================
# Calqué sur terraform/ de RoastMyPic.ai : état dans le bucket partagé,
# provider bootstrap pour la création du projet, projet dédié par produit.
# =============================================================================

terraform {
  required_version = ">= 1.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }

  backend "gcs" {
    bucket = "micro-sass-478507-tfstate"
    prefix = "terraform/devine"
  }
}

provider "google" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}

provider "google" {
  alias                 = "bootstrap"
  project               = var.bootstrap_project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.bootstrap_project_id
}

locals {
  services = [
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "firestore.googleapis.com",
    "aiplatform.googleapis.com",
    "servicenetworking.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "certificatemanager.googleapis.com",
    "cloudbuild.googleapis.com",
    "secretmanager.googleapis.com",
    "iam.googleapis.com",
    "storage.googleapis.com",
  ]
}

resource "google_project_service" "apis" {
  for_each                   = toset(local.services)
  provider                   = google.bootstrap
  project                    = var.project_id
  service                    = each.value
  disable_dependent_services = false
  disable_on_destroy         = false

  # Sans ce lien, l'activation des APIs part en parallèle de la création du
  # projet et échoue en 403 « project not found » le temps de la propagation.
  depends_on = [google_project.app]
}
