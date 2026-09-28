output "service_url" {
  value       = google_cloud_run_v2_service.devine.uri
  description = "URL Cloud Run publique (fonctionne sans mapping domaine)"
}

output "domain_mapping_records" {
  value       = var.create_domain_mapping ? google_cloud_run_domain_mapping.devine[0].status[0].resource_records : []
  description = "Enregistrements TXT/CNAME à poser chez le registrar (googledomains/Squarespace) pour devine.ghotatechsolutions.com"
}
