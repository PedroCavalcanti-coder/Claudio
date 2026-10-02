import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { Mic, MicOff, Video, VideoOff, PhoneOff, Loader2 } from 'lucide-react';
import { teleconsultApi } from '../../api/endpoints';

/**
 * Sala de teleconsulta (WebRTC P2P). Sem provedor pago e sem socket.io: a
 * sinalização (offer/answer/ICE) trafega por REST com polling; a mídia é P2P
 * direta (STUN público). `?host=1` = médico (cria a oferta); padrão = paciente.
 * Rota fora do AppLayout (tela cheia), sob PrivateRoute.
 */
const STUN = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
const sel = (r: any) => (r.data as any).data;

export default function TeleRoomPage() {
  const { token = '' } = useParams();
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const role: 'host' | 'guest' = sp.get('host') === '1' ? 'host' : 'guest';

  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const sinceRef = useRef(0);
  const pollRef = useRef<number | null>(null);
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  const startedRef = useRef(false);

  const [status, setStatus] = useState<'connecting' | 'waiting' | 'connected' | 'ended' | 'error'>('connecting');
  const [errMsg, setErrMsg] = useState('');
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let cancelled = false;

    const post = (kind: string, payload: unknown) =>
      teleconsultApi.postSignal(token, { sender: role, kind, payload }).catch(() => {});

    const flushIce = async (pc: RTCPeerConnection) => {
      for (const c of pendingIce.current) { try { await pc.addIceCandidate(c); } catch { /* ignore */ } }
      pendingIce.current = [];
    };

    const handleSignal = async (pc: RTCPeerConnection, s: any) => {
      const payload = typeof s.payload === 'string' ? JSON.parse(s.payload) : s.payload;
      if (s.kind === 'offer' && role === 'guest') {
        await pc.setRemoteDescription(new RTCSessionDescription(payload));
        await flushIce(pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await post('answer', answer);
      } else if (s.kind === 'answer' && role === 'host') {
        await pc.setRemoteDescription(new RTCSessionDescription(payload));
        await flushIce(pc);
      } else if (s.kind === 'ice') {
        if (pc.remoteDescription) { try { await pc.addIceCandidate(payload); } catch { /* ignore */ } }
        else pendingIce.current.push(payload);
      } else if (s.kind === 'bye') {
        endCall(false);
      }
    };

    const poll = async (pc: RTCPeerConnection) => {
      try {
        const r = await teleconsultApi.getSignals(token, { since: sinceRef.current, role });
        const list = sel(r) as any[];
        for (const s of list) { sinceRef.current = Math.max(sinceRef.current, Number(s.id)); await handleSignal(pc, s); }
      } catch { /* transient */ }
    };

    (async () => {
      try {
        // valida a sala
        await teleconsultApi.room(token);
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        localStreamRef.current = stream;
        if (localRef.current) localRef.current.srcObject = stream;

        const pc = new RTCPeerConnection({ iceServers: STUN });
        pcRef.current = pc;
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));

        pc.onicecandidate = (e) => { if (e.candidate) post('ice', e.candidate.toJSON()); };
        pc.ontrack = (e) => { if (remoteRef.current) { remoteRef.current.srcObject = e.streams[0]; setStatus('connected'); } };
        pc.onconnectionstatechange = () => {
          if (pc.connectionState === 'connected') setStatus('connected');
          if (pc.connectionState === 'failed') { setStatus('error'); setErrMsg('Falha na conexão P2P (rede/NAT). Tente novamente.'); }
        };

        if (role === 'host') {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await post('offer', offer);
          setStatus('waiting');
        } else {
          setStatus('waiting');
        }
        pollRef.current = window.setInterval(() => poll(pc), 1200);
      } catch (e: any) {
        setStatus('error');
        setErrMsg(e?.name === 'NotAllowedError' ? 'Permissão de câmera/microfone negada.' : (e?.message || 'Erro ao iniciar a sala.'));
      }
    })();

    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
      pcRef.current?.close();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, role]);

  const endCall = (notify = true) => {
    // Notifica o outro par via sinal 'bye' (a sala já vira 'active' no 1º offer).
    // O encerramento administrativo da sessão (status='ended') é feito na página
    // do profissional, que tem o id da sessão — aqui só temos o room_token.
    if (notify) teleconsultApi.postSignal(token, { sender: role, kind: 'bye', payload: {} }).catch(() => {});
    if (pollRef.current) clearInterval(pollRef.current);
    pcRef.current?.close();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    setStatus('ended');
  };

  const toggleMic = () => { const t = localStreamRef.current?.getAudioTracks()[0]; if (t) { t.enabled = !t.enabled; setMicOn(t.enabled); } };
  const toggleCam = () => { const t = localStreamRef.current?.getVideoTracks()[0]; if (t) { t.enabled = !t.enabled; setCamOn(t.enabled); } };

  return (
    <div className="fixed inset-0 bg-navy-950 flex flex-col">
      <div className="flex-1 relative">
        <video ref={remoteRef} autoPlay playsInline className="w-full h-full object-contain bg-black" />
        <video ref={localRef} autoPlay playsInline muted className="absolute bottom-4 right-4 w-40 sm:w-56 rounded-lg border border-navy-700 shadow-lg object-cover aspect-video bg-black" />

        {status !== 'connected' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 bg-black/40">
            {status === 'error' ? (
              <>
                <p className="text-red-400 font-medium">Não foi possível conectar</p>
                <p className="text-slate-400 text-sm mt-1 max-w-sm">{errMsg}</p>
              </>
            ) : status === 'ended' ? (
              <p className="text-slate-300">Chamada encerrada.</p>
            ) : (
              <>
                <Loader2 className="animate-spin text-cyan-400" size={28} />
                <p className="text-slate-300 mt-3">{status === 'waiting' ? 'Aguardando o outro participante…' : 'Preparando câmera e microfone…'}</p>
                <p className="text-slate-600 text-xs mt-1">{role === 'host' ? 'Você é o anfitrião (profissional).' : 'Você é o paciente.'}</p>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-center gap-3 py-4 bg-navy-900 border-t border-navy-800">
        <button onClick={toggleMic} className={`w-11 h-11 rounded-full flex items-center justify-center ${micOn ? 'bg-navy-700 text-slate-200' : 'bg-red-600 text-white'}`} title="Microfone">
          {micOn ? <Mic size={18} /> : <MicOff size={18} />}
        </button>
        <button onClick={toggleCam} className={`w-11 h-11 rounded-full flex items-center justify-center ${camOn ? 'bg-navy-700 text-slate-200' : 'bg-red-600 text-white'}`} title="Câmera">
          {camOn ? <Video size={18} /> : <VideoOff size={18} />}
        </button>
        <button onClick={() => { endCall(true); setTimeout(() => navigate(-1), 300); }} className="w-11 h-11 rounded-full flex items-center justify-center bg-red-600 text-white" title="Encerrar">
          <PhoneOff size={18} />
        </button>
      </div>
    </div>
  );
}
