import type { User } from '../types';

/**
 * Slug de URL para a unidade de saúde.
 * Deriva do nome (legível) e cai para o id quando não há nome carregado.
 * Determinístico → o mesmo user sempre produz o mesmo slug, então o redirect
 * de login e o guard de rota concordam sem flicker.
 */
export function slugifyUnit(name?: string | null): string {
  if (!name) return '';
  return name
    .normalize('NFKD').replace(/[̀-ͯ]/g, '') // remove acentos
    .replace(/[^a-zA-Z0-9]+/g, '-')                     // separadores → hífen
    .replace(/^-+|-+$/g, '')                            // trim hífens
    .toLowerCase();
}

/** Slug canônico da unidade do usuário (nome slugificado ou id como fallback). */
export function unitSlug(user?: Pick<User, 'health_unit_id' | 'health_unit_name'> | null): string | null {
  if (!user?.health_unit_id) return null;
  return slugifyUnit(user.health_unit_name) || user.health_unit_id;
}

/** Caminho da home da unidade do usuário (ex.: /u/ubs-centro). */
export function unitHomePath(user?: Pick<User, 'health_unit_id' | 'health_unit_name'> | null): string | null {
  const slug = unitSlug(user);
  return slug ? `/u/${slug}` : null;
}
