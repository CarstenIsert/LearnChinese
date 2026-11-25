import { useCallback, useEffect, useRef, useState } from 'react';
import { LiveAudioManager } from '../audio.ts';
import { ServerWsMessage } from '../types.ts';

interface StartVoiceSessionOptions {
  startPayload: Record<string, unknown>;
  onMessage: (msg: ServerWsMessage) => void;
  onError: (message: string) => void;
  onUnexpectedClose?: () => void;
  onAiSpeakingChange?: (speaking: boolean) => void;
}

export function useLiveVoiceSession() {
  const wsRef = useRef<WebSocket | null>(null);
  const audioRef = useRef<LiveAudioManager | null>(null);
  const orbWrapperRef = useRef<HTMLDivElement | null>(null);
  const orbCircleRef = useRef<HTMLDivElement | null>(null);
  const micMeterRef = useRef<HTMLDivElement | null>(null);
  const intentionalCloseRef = useRef<boolean>(false);
  const lastAiSpeakingRef = useRef<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);

  const resetVisualIndicators = useCallback(() => {
    if (orbWrapperRef.current) {
      orbWrapperRef.current.style.setProperty('--orb-scale', '0');
      orbWrapperRef.current.style.setProperty('--orb-glow', '0');
    }
    if (orbCircleRef.current) {
      orbCircleRef.current.classList.remove('ai-speaking');
    }
    if (micMeterRef.current) {
      micMeterRef.current.style.width = '0%';
    }
    lastAiSpeakingRef.current = false;
  }, []);

  const stopSession = useCallback(
    (options?: { sendEndSession?: boolean; keepSocketOpenForRecap?: boolean }) => {
      const sendEndSession = options?.sendEndSession ?? false;
      const keepSocketOpenForRecap = options?.keepSocketOpenForRecap ?? false;

      if (audioRef.current) {
        audioRef.current.stopAll();
        audioRef.current = null;
      }
      resetVisualIndicators();
      setIsMuted(false);

      const ws = wsRef.current;
      if (!ws) return;

      if (sendEndSession && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'end_session' }));
      }

      if (!keepSocketOpenForRecap) {
        intentionalCloseRef.current = true;
        try {
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close();
          }
        } catch {
          // ignore close errors
        }
        wsRef.current = null;
      }
    },
    [resetVisualIndicators]
  );

  const startSession = useCallback(
    async ({
      startPayload,
      onMessage,
      onError,
      onUnexpectedClose,
      onAiSpeakingChange,
    }: StartVoiceSessionOptions): Promise<boolean> => {
      stopSession();
      intentionalCloseRef.current = false;

      try {
        const audioManager = new LiveAudioManager();
        audioRef.current = audioManager;

        audioManager.onVolumeChange = (vol, speaking) => {
          if (orbWrapperRef.current) {
            orbWrapperRef.current.style.setProperty('--orb-scale', String(vol));
            orbWrapperRef.current.style.setProperty('--orb-glow', String(vol));
          }
          if (orbCircleRef.current) {
            orbCircleRef.current.classList.toggle('ai-speaking', speaking);
          }
          if (micMeterRef.current) {
            micMeterRef.current.style.width = `${Math.min(100, Math.round(vol * 100))}%`;
          }
          if (onAiSpeakingChange && speaking !== lastAiSpeakingRef.current) {
            lastAiSpeakingRef.current = speaking;
            onAiSpeakingChange(speaking);
          }
        };

        await audioManager.startMicrophone();

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${protocol}//${window.location.host}/ws/live`);
        wsRef.current = ws;

        audioManager.onAudioInputChunk = (base64Pcm) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'audio_input', data: base64Pcm }));
          }
        };

        ws.onopen = () => {
          ws.send(JSON.stringify(startPayload));
        };

        ws.onmessage = (event) => {
          let msg: ServerWsMessage;
          try {
            msg = JSON.parse(String(event.data)) as ServerWsMessage;
          } catch {
            return;
          }
          if (!msg || typeof msg.type !== 'string') return;

          if (msg.type === 'audio_chunk') {
            audioManager.playPcm24kChunk(msg.data);
          } else if (msg.type === 'interrupted') {
            audioManager.interruptPlayback();
          }

          onMessage(msg);
        };

        ws.onerror = () => {
          if (intentionalCloseRef.current) return;
          stopSession();
          onError('WebSocket-Verbindungsfehler zum Server.');
        };

        ws.onclose = () => {
          const wasIntentional = intentionalCloseRef.current;
          if (audioRef.current) {
            audioRef.current.stopAll();
            audioRef.current = null;
          }
          resetVisualIndicators();
          wsRef.current = null;
          if (!wasIntentional) {
            onUnexpectedClose?.();
          }
        };

        return true;
      } catch (err: unknown) {
        stopSession();
        const message = err instanceof Error && err.message ? err.message : 'Bitte Mikrofonzugriff erlauben.';
        onError(message);
        return false;
      }
    },
    [resetVisualIndicators, stopSession]
  );

  const sendJson = useCallback((payload: Record<string, unknown>): boolean => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      audioRef.current?.setMuted(next);
      return next;
    });
  }, []);

  useEffect(() => {
    return () => {
      stopSession();
    };
  }, [stopSession]);

  return {
    orbWrapperRef,
    orbCircleRef,
    micMeterRef,
    isMuted,
    startSession,
    stopSession,
    sendJson,
    toggleMute,
    markIntentionalClose: () => {
      intentionalCloseRef.current = true;
    },
  };
}
