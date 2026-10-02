import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, BellDot, CheckCheck, FileText, FileImage, Send, AlertTriangle, Clock, X } from 'lucide-react';
import api from '../../api/client';
import { formatDateTime } from '../../utils/format';

// Tipos emitidos pelo backend em createNotification — manter em sincronia com o enum do server
const TYPE_ICONS: Record<string, React.ElementType> = {
  IMAGES_READY:      FileImage,
  REPORT_SIGNED:     FileText,
  REFERRAL_RECEIVED: Send,
  REFERRAL_ACCEPTED: Send,
  REFERRAL_DECLINED: Send,
  SLA_OVERDUE:       AlertTriangle,
  DEFAULT:           Bell,
};

const TYPE_COLORS: Record<string, string> = {
  IMAGES_READY:      'text-blue-400 bg-blue-400/10',
  REPORT_SIGNED:     'text-emerald-400 bg-emerald-400/10',
  REFERRAL_RECEIVED: 'text-purple-400 bg-purple-400/10',
  REFERRAL_ACCEPTED: 'text-emerald-400 bg-emerald-400/10',
  REFERRAL_DECLINED: 'text-amber-400 bg-amber-400/10',
  SLA_OVERDUE:       'text-red-400 bg-red-400/10',
  DEFAULT:           'text-slate-400 bg-slate-400/10',
};

const RESOURCE_ROUTE: Record<string, string> = {
  referral: '/referrals',
  report:   '/reports',
  study:    '/studies',
};

export default function NotificationsPanel() {
  const [open, setOpen] = useState(false);
  const ref             = useRef<HTMLDivElement>(null);
  const qc              = useQueryClient();
  const navigate        = useNavigate();

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn:  () => api.get('/notifications', { params: { limit: 20 } }),
    select:   r => r.data.data,
    refetchInterval: 30_000,
  });

  const notifications: any[] = data?.notifications ?? [];
  const unreadCount           = data?.unread_count ?? 0;

  const readMut = useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const readAllMut = useMutation({
    mutationFn: () => api.patch('/notifications/read-all'),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const handleClick = (n: any) => {
    if (!n.read_at) readMut.mutate(n.id);
    const route = RESOURCE_ROUTE[n.resource_type];
    if (route) { setOpen(false); navigate(route); }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(p => !p)}
        className="relative p-2 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-navy-800 transition-all"
        title="Notificações"
      >
        {unreadCount > 0 ? <BellDot size={18} className="text-cyan-400" /> : <Bell size={18} />}
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full
                           bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-10 w-80 rounded-2xl shadow-2xl z-50 overflow-hidden animate-slide-up"
          style={{ background: '#080f1c', border: '1px solid #112240', boxShadow: '0 25px 50px rgba(0,0,0,0.7)' }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-navy-700">
            <div className="flex items-center gap-2">
              <Bell size={14} className="text-cyan-400" />
              <span className="font-display font-semibold text-slate-100 text-sm">Notificações</span>
              {unreadCount > 0 && (
                <span className="badge badge-info text-[10px]">{unreadCount} novas</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  className="text-xs text-slate-500 hover:text-cyan-400 transition-colors flex items-center gap-1"
                  onClick={() => readAllMut.mutate()}
                >
                  <CheckCheck size={12} /> Ler todas
                </button>
              )}
              <button className="text-slate-600 hover:text-slate-300 transition-colors" onClick={() => setOpen(false)}>
                <X size={14} />
              </button>
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2">
                <Bell size={24} className="text-slate-700" />
                <p className="text-slate-500 text-sm">Nenhuma notificação</p>
              </div>
            ) : (
              notifications.map(n => {
                const Icon  = TYPE_ICONS[n.type]  ?? TYPE_ICONS.DEFAULT;
                const color = TYPE_COLORS[n.type] ?? TYPE_COLORS.DEFAULT;
                const isUnread = !n.read_at;

                return (
                  <div
                    key={n.id}
                    className={`flex gap-3 px-4 py-3 border-b border-navy-800/50 cursor-pointer
                      transition-colors hover:bg-navy-800/40 ${isUnread ? 'bg-navy-900/60' : ''}`}
                    onClick={() => handleClick(n)}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${color}`}>
                      <Icon size={14} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-sm font-medium leading-tight ${isUnread ? 'text-slate-100' : 'text-slate-400'}`}>
                          {n.title}
                        </p>
                        {isUnread && (
                          <span className="w-2 h-2 rounded-full bg-cyan-400 shrink-0 mt-1.5" />
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{n.body}</p>
                      <p className="text-[10px] font-mono text-slate-600 mt-1 flex items-center gap-1">
                        <Clock size={9} /> {formatDateTime(n.created_at)}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {notifications.length > 0 && (
            <div className="px-4 py-2.5 border-t border-navy-700 text-center">
              <span className="text-[10px] text-slate-600 font-mono">
                Mostrando {notifications.length} notificações
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
