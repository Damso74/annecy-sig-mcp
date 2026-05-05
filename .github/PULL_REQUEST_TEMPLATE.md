<!--
  Merci pour votre contribution !
  Cocher les cases applicables ci-dessous (transformer [ ] en [x]).
-->

## Contexte

<!-- Quel problème cette PR résout, lien vers l'issue le cas échéant. -->

Closes #

## Type de changement

- [ ] 🐛 Bug fix (changement non breaking corrigeant un comportement)
- [ ] ✨ Nouvelle fonctionnalité (changement non breaking ajoutant du comportement)
- [ ] 💥 Breaking change (modification de contrat ou de comportement existant)
- [ ] 📚 Documentation seule
- [ ] 🔧 Outillage / refacto interne (sans impact comportemental)
- [ ] 📍 Ajout d'une couche au registre

## Checklist

- [ ] Mes commits suivent la convention `type(scope): subject`
- [ ] J'ai exécuté `npm test` localement et tout passe
- [ ] J'ai exécuté `npm run smoke:mcp` (transport stdio)
- [ ] Si la PR touche le transport HTTP : j'ai exécuté `npm run smoke:http`
- [ ] Si nouveau code métier : j'ai ajouté au moins un test offline
- [ ] Si nouveau contrat Zod : `schemaVersion: *.v1` respecté, `npm run schemas:check` OK
- [ ] J'ai mis à jour le `CHANGELOG.md` si l'impact utilisateur est visible
- [ ] Aucun secret, jeton ou champ sensible n'apparaît dans le diff
- [ ] Si nouvelle couche : `scripts/sync-registry-from-arcgis.ts` exécuté et fichier généré commité

## Captures / logs (si pertinent)

<!-- Pour les changements UI (landing) ou les comportements observables. -->
