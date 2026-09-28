variable "project_id" {
  description = "Projet dédié, pattern ghota-<produit>-prod."
  type        = string
}

variable "project_name" {
  type    = string
  default = "Devine Production"
}

variable "bootstrap_project_id" {
  description = "Projet partagé qui héberge l'état Terraform (comme RoastMyPic)."
  type        = string
  default     = "micro-sass-478507"
}

variable "billing_account" {
  description = "Compte de facturation (dans tfvars, jamaiscommité si sensible)."
  type        = string
}

variable "budget_billing_account" {
  description = "Compte de facturation pour l'alerte budget (identique au précédent en général)."
  type        = string
}

variable "folder_id" {
  type    = string
  default = null
}

variable "region" {
  type    = string
  default = "europe-west1"
}

variable "domain" {
  type    = string
  default = "ghotatechsolutions.com"
}

variable "container_image" {
  description = "Image construite et poussée dans Artifact Registry (tag = court sha)."
  type        = string
}

variable "vertex_model" {
  description = "Identifiant exact du modèle Gemini Flash — figé après vérification gcloud."
  type        = string
  default     = "gemini-flash-latest"
}

variable "max_rounds_per_day" {
  type    = number
  default = 150
}

variable "per_ip_per_window" {
  type    = number
  default = 5
}

variable "omlx_url" {
  description = "URL de l'oMLX joignable par Cloud Run (IP publique de la box, jamais exposée au navigateur). Passée via TF_VAR_omlx_url."
  type        = string
}

variable "local_model" {
  description = "Alias du modèle servi par oMLX (LOCAL_MODEL)."
  type        = string
}

variable "omlx_api_key" {
  description = "Clé API oMLX (TF_VAR_omlx_api_key, lue depuis ~/.omlx/settings.json — jamais commitée, jamais affichée)."
  type        = string
  sensitive   = true
}

variable "create_domain_mapping" {
  description = "0 tant que la TXT de vérification n'est pas en place chez le registrar."
  type        = bool
  default     = false
}
