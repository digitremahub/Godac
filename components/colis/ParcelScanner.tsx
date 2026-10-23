"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { chargerDetecteur, type Detecteur } from "@/lib/colis/detecteur";
import { activerAutofocus, ouvrirCamera, relacherCamera, reglerTorche, torcheSupportee } from "@/lib/colis/camera";
import { AntiDoublon, delaiProchaineDetection, messageErreurCamera, normaliserCodeLu, validerSaisieManuelle } from "@/lib/colis/scan";

/**
 * Scanner continu pour charger une tournée : on passe les colis devant
 * la caméra les uns après les autres. Lit QR, Datamatrix et codes-barres
 * 1D avec le détecteur natif du navigateur, ou ZXing là où il manque
 * (iPhone, Firefox) — voir lib/colis/detecteur.ts. jsQR (QR seulement)
 * ne sert que si aucun des deux ne se charge, et l'écran le dit.
 *
 * À chaque lecture : bip + vibration, et le même code est ignoré tant
 * qu'il reste devant la caméra puis 2 s après. La saisie manuelle du
 * numéro reste toujours accessible (caméra refusée, étiquette abîmée).
 * Le flux caméra est réutilisé d'une ouverture à l'autre (lib/colis/camera.ts).
 *
 * `consigne`, `bouton` et `calque` adaptent le scanner à d'autres usages
 * (QR code du destinataire à la livraison, au-dessus de la feuille de
 * livraison). `capturerImage` joint une photo nette de l'étiquette
 * (1600 px) pour la lecture automatique de l'adresse.
 */
export function ParcelScanner({
  onCode,
  onClose,
  consigne = "Passez les colis un par un devant la caméra",
  bouton = "Terminer le scan",
  statut = "",
  calque = "z-[60]",
  capturerImage = false,
}: {
  onCode: (text: string, image?: string) => void;
  onClose: () => void;
  consigne?: string;
  bouton?: string;
  statut?: string;
  calque?: string;
  capturerImage?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const doublons = useRef(new AntiDoublon());
  const [erreur, setErreur] = useState<string | null>(null);
  const [cameraPrete, setCameraPrete] = useState(false);
  const [lecteur, setLecteur] = useState<"chargement" | "complet" | "qr">("chargement");
  const [flash, setFlash] = useState(false);
  const [torche, setTorche] = useState<{ dispo: boolean; allumee: boolean }>({ dispo: false, allumee: false });
  const [saisie, setSaisie] = useState("");
  const [erreurSaisie, setErreurSaisie] = useState<string | null>(null);
  const [relance, setRelance] = useState(0);
  const capturerRef = useRef(capturerImage);
  capturerRef.current = capturerImage;
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  const bip = useCallback(() => {
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = (audioRef.current ??= new Ctx());
      void ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = 1568;
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.13);
    } catch {
      /* pas de son : la vibration et le cadre vert restent */
    }
  }, []);

  const retour = useCallback(() => {
    bip();
    navigator.vibrate?.(60);
    setFlash(true);
    setTimeout(() => setFlash(false), 300);
  }, [bip]);

  const emettre = useCallback(
    (brut: string, source: "camera" | "saisie") => {
      const text = normaliserCodeLu(brut);
      if (!text) return;
      if (source === "camera" && !doublons.current.accepter(text, Date.now())) return;
      retour();
      // Photo nette de l'étiquette au moment du scan, pour lire l'adresse automatiquement.
      let image: string | undefined;
      const video = videoRef.current;
      if (source === "camera" && capturerRef.current && video?.videoWidth && video.videoHeight) {
        const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
        const shot = document.createElement("canvas");
        shot.width = Math.round(video.videoWidth * scale);
        shot.height = Math.round(video.videoHeight * scale);
        const ctx = shot.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, shot.width, shot.height);
          image = shot.toDataURL("image/jpeg", 0.8).split(",")[1];
        }
      }
      onCodeRef.current(text, image);
    },
    [retour],
  );

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let detector: Detecteur | null = null;
    let natif = false;
    const video = videoRef.current;

    chargerDetecteur().then(({ detecteur, source }) => {
      if (cancelled) return;
      detector = detecteur;
      natif = source === "natif";
      setLecteur(detecteur ? "complet" : "qr");
    });

    async function tick() {
      if (cancelled) return;
      const t0 = performance.now();
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState >= 2 && !document.hidden) {
        try {
          if (detector) {
            const codes = await detector.detect(video);
            if (codes[0]?.rawValue) emettre(codes[0].rawValue, "camera");
          } else {
            // Repli QR seul : image réduite, jsQR est lent sur du 1080p.
            const echelle = Math.min(1, 960 / video.videoWidth);
            const w = Math.round(video.videoWidth * echelle);
            const h = Math.round(video.videoHeight * echelle);
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(video, 0, 0, w, h);
              const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h);
              if (code?.data) emettre(code.data, "camera");
            }
          }
        } catch {
          /* image suivante */
        }
      }
      if (!cancelled) timer = setTimeout(tick, delaiProchaineDetection(performance.now() - t0, natif));
    }

    const surArret = () => !cancelled && setErreur("La caméra s'est arrêtée. Appuyez sur « Relancer la caméra » ou saisissez le numéro à la main.");
    const surVisibilite = () => {
      if (!document.hidden && video?.paused && streamRef.current) void video.play().catch(() => undefined);
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setErreur(messageErreurCamera(null, window.isSecureContext));
        return;
      }
      try {
        const stream = await ouvrirCamera();
        if (cancelled) {
          relacherCamera();
          return;
        }
        streamRef.current = stream;
        stream.getVideoTracks()[0]?.addEventListener("ended", surArret);
        void activerAutofocus(stream);
        setTorche({ dispo: torcheSupportee(stream), allumee: false });
        if (video) {
          video.srcObject = stream;
          await video.play();
        }
        if (cancelled) return;
        setCameraPrete(true);
        setErreur(null);
        tick();
      } catch (e) {
        if (!cancelled) setErreur(messageErreurCamera(e, window.isSecureContext));
      }
    })();

    document.addEventListener("visibilitychange", surVisibilite);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", surVisibilite);
      const stream = streamRef.current;
      if (stream) {
        stream.getVideoTracks()[0]?.removeEventListener("ended", surArret);
        void reglerTorche(stream, false);
        relacherCamera();
      }
      streamRef.current = null;
      if (video) video.srcObject = null;
      void audioRef.current?.close().catch(() => undefined);
      audioRef.current = null;
    };
  }, [emettre, relance]);

  async function basculerTorche() {
    const stream = streamRef.current;
    if (!stream) return;
    const voulu = !torche.allumee;
    if (await reglerTorche(stream, voulu)) setTorche({ dispo: true, allumee: voulu });
  }

  function valider(e: React.FormEvent) {
    e.preventDefault();
    const r = validerSaisieManuelle(saisie);
    if (!r.ok) return setErreurSaisie(r.erreur);
    setErreurSaisie(null);
    setSaisie("");
    emettre(r.code, "saisie");
  }

  const etat = erreur ? { texte: "Caméra indisponible", classe: "bg-orange text-on-orange" } : !cameraPrete ? { texte: "Ouverture de la caméra…", classe: "bg-white/20 text-white" } : lecteur === "chargement" ? { texte: "Caméra prête · chargement du lecteur…", classe: "bg-white/20 text-white" } : { texte: "Caméra prête", classe: "bg-teal text-on-teal" };

  return (
    <div className={`fixed inset-0 ${calque} flex flex-col bg-black`} role="dialog" aria-modal="true" aria-label="Scanner">
      <div className="relative flex-1 overflow-hidden">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} playsInline muted autoPlay className="h-full w-full object-cover" />
        <canvas ref={canvasRef} className="hidden" />
        <div aria-hidden="true" className={`pointer-events-none absolute left-1/2 top-1/2 h-56 w-[88%] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border-4 transition-colors ${flash ? "border-teal bg-teal/20" : "border-white/70"}`} />
        <div className="absolute inset-x-0 top-4 flex flex-col items-center gap-1 px-3 text-center">
          <p className="text-sm font-semibold text-white drop-shadow">{consigne}</p>
          <span role="status" className={`rounded-full px-3 py-1 text-xs font-semibold ${etat.classe}`}>
            {etat.texte}
          </span>
          <span className="text-xs text-white/80 drop-shadow">
            {lecteur === "qr" ? "Lecteur de codes-barres indisponible : codes QR seulement" : "QR, Datamatrix et codes-barres"}
          </span>
          {statut && <span className="mx-auto mt-1 block max-w-[90%] rounded-lg bg-teal px-3 py-2 text-sm font-semibold text-on-teal">{statut}</span>}
        </div>
        {torche.dispo && (
          <button type="button" aria-pressed={torche.allumee} onClick={basculerTorche} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-black/55 px-3 py-3 text-xs font-semibold text-white">
            {torche.allumee ? "Éteindre la lampe" : "Allumer la lampe"}
          </button>
        )}
        {erreur && (
          <div role="alert" className="absolute inset-x-4 bottom-4 flex flex-col gap-2 rounded-xl bg-orange px-4 py-3 text-sm font-semibold text-on-orange">
            <p>{erreur}</p>
            <button type="button" className="self-start rounded-lg bg-white/90 px-3 py-1.5 text-sm text-navy" onClick={() => { setErreur(null); setCameraPrete(false); setRelance((n) => n + 1); }}>
              Relancer la caméra
            </button>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-3 bg-marine p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <form onSubmit={valider} className="flex gap-2">
          <input
            className="input min-w-0 flex-1"
            value={saisie}
            onChange={(e) => {
              setSaisie(e.target.value);
              setErreurSaisie(null);
            }}
            placeholder="Ou saisissez le n° du colis"
            aria-label="Numéro du colis saisi à la main"
            aria-invalid={erreurSaisie !== null}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
          />
          <button type="submit" className="btn-secondary !px-4">
            Valider
          </button>
        </form>
        {erreurSaisie && <p role="alert" className="-mt-1 text-sm font-semibold text-orange">{erreurSaisie}</p>}
        <button type="button" className="btn-primary w-full !py-3 text-base" onClick={onClose}>
          {bouton}
        </button>
      </div>
    </div>
  );
}
