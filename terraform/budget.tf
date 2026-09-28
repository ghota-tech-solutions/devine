# =============================================================================
# BUDGET — ce projet doit rester un jouet : alerte dès 10 €/mois
# (Vertex Flash consomme peu, mais un duel public peut diverger sans cela.)
# =============================================================================

resource "google_billing_budget" "devine" {
  provider        = google.bootstrap
  billing_account = var.budget_billing_account
  display_name    = "devine — ${var.project_id}"
  budget_filter {
    # L'API ignore un ID de projet ici et crée un budget GLOBAL au compte de
    # facturation. Le numéro de projet s'impose (même convention que le
    # budget RoastMyPic créé dans la console).
    projects = ["projects/${google_project.app.number}"]
  }
  amount {
    specified_amount {
      currency_code = "EUR"
      units         = "10"
    }
  }
  threshold_rules {
    threshold_percent = 0.5
    spend_basis       = "CURRENT_SPEND"
  }
  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "FORECASTED_SPEND"
  }
}
