import { Sun, Moon, Leaf } from 'lucide-react';
import { useThemeStore, type Theme } from '../../stores/themeStore';

/**
 * Botão único e redondo que cicla pelos 3 temas: light → dark → comfort → light.
 * O ícone exibido é o do tema *atualmente ativo*; o tooltip indica o próximo.
 */

const CYCLE: Theme[] = ['light', 'dark', 'comfort'];

const META: Record<Theme, { Icon: React.ElementType; label: string }> = {
  light:   { Icon: Sun,  label: 'Claro'    },
  dark:    { Icon: Moon, label: 'Escuro'   },
  comfort: { Icon: Leaf, label: 'Conforto' },
};

// `compact` é aceito por compatibilidade com os layouts de login/portal (o botão já é compacto).
export default function ThemeToggle(_props: { compact?: boolean } = {}) {
  const { theme, setTheme } = useThemeStore();
  const { Icon, label }     = META[theme];

  const next      = CYCLE[(CYCLE.indexOf(theme) + 1) % CYCLE.length];
  const nextLabel = META[next].label;

  return (
    <button
      onClick={() => setTheme(next)}
      title={`Tema: ${label} (clique para ${nextLabel})`}
      aria-label={`Tema atual: ${label}. Clique para mudar para ${nextLabel}.`}
      style={{
        width: 36,
        height: 36,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--navy-800)',
        border: '1px solid var(--navy-700)',
        color: 'var(--sl-300)',
        cursor: 'pointer',
        transition: 'background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease, transform 0.1s ease',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background   = 'var(--navy-700)';
        e.currentTarget.style.borderColor  = 'var(--color-accent)';
        e.currentTarget.style.color        = 'var(--color-accent)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background   = 'var(--navy-800)';
        e.currentTarget.style.borderColor  = 'var(--navy-700)';
        e.currentTarget.style.color        = 'var(--sl-300)';
      }}
      onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.94)'; }}
      onMouseUp={e =>   { e.currentTarget.style.transform = 'scale(1)'; }}
    >
      <Icon size={16} strokeWidth={2} />
    </button>
  );
}
