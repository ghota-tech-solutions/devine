// IP du visiteur pour la limite par fenêtre. Un en-tête posé par le client
// ne doit jamais faire foi : sur Cloud Run, le frontal Google AJOUTE l'IP
// réelle en fin de X-Forwarded-For (les valeurs du début sont forgeables).
export function clientIp(headers: Headers): string {
  const xff = headers.get('x-forwarded-for');
  const last = xff?.split(',').map((s) => s.trim()).filter(Boolean).pop();
  return last ?? 'inconnue';
}
