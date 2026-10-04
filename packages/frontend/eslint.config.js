import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // `_x` = parâmetro/variável intencionalmente não usado
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      // Dívida de tipagem (≈400 `any` espalhados, a maioria em respostas da API): AVISO, não erro.
      // Novas ocorrências aparecem no relatório do CI sem travar o merge; reduzir aos poucos.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Só importa para o Fast Refresh em desenvolvimento (arquivo exporta componente + constante).
      'react-refresh/only-export-components': 'warn',
      // Sincronizar estado derivado dentro de um efeito (ex.: preencher o 1º item de uma lista carregada,
      // resetar ao fechar) é um padrão legítimo e sem cascata de renders aqui; a regra nova do plugin
      // é conservadora. Mantida como aviso para revisão — as regras de pureza/ordem seguem como erro.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  {
    // Viewer DICOM (Cornerstone/WebGL/vtk): código imperativo, com refs lidos durante o render por
    // desenho (handles do canvas) e catch vazios em limpeza de recursos nativos. As regras do React
    // Compiler e de estilo não se aplicam a este código; o restante do app segue com todas ativas.
    files: ['src/orthovis/**/*.{ts,tsx}', 'src/pages/viewer/**/*.{ts,tsx}'],
    rules: {
      'react-hooks/refs': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/static-components': 'off',
      'no-empty': 'off',
      'no-useless-assignment': 'off',
    },
  },
])
