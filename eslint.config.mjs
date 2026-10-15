import prettier from 'eslint-config-prettier'
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  // Must be last: disables every ESLint rule that conflicts with Prettier
  prettier,
)
