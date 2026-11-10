export function exactPortugalVoice(voices: Pick<SpeechSynthesisVoice, 'lang'>[]): Pick<SpeechSynthesisVoice, 'lang'> | undefined {
  return voices.find(v => v.lang.toLowerCase().replace('_', '-') === 'pt-pt');
}
export function guardLegacySpeech(report: (message: string) => void): void {
  if (!window.speechSynthesis) return;
  const synth = window.speechSynthesis, original = synth.speak.bind(synth);
  // Public Web Speech API boundary, installed before the legacy module. No React/DOM internals.
  synth.speak = (utterance: SpeechSynthesisUtterance) => {
    if (/^pt(?:-|_|$)/i.test(utterance.lang)) {
      const voice = utterance.voice?.lang.toLowerCase().replace('_', '-') === 'pt-pt' ? utterance.voice :
        (exactPortugalVoice(synth.getVoices().filter(v => v.localService)) || exactPortugalVoice(synth.getVoices())) as SpeechSynthesisVoice | undefined;
      if (!voice) { report('Portugal voice unavailable. Continue with text practice; no Brazilian fallback.'); return; }
      utterance.lang = 'pt-PT'; utterance.voice = voice;
    }
    if (/^ar(?:-|_|$)/i.test(utterance.lang)) { report('No verified Tunisian audio is included.'); return; }
    original(utterance);
  };
}
export function speak(text: string, language: string, report: (message: string) => void): void {
  if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) { report('System audio unavailable. Text practice remains available.'); return; }
  const lang = ({ de: 'de-DE', fr: 'fr-FR', it: 'it-IT', pt: 'pt-PT' } as Record<string, string>)[language];
  if (!lang) { report('No verified voice for this language.'); return; }
  const voice = speechSynthesis.getVoices().find(v => v.lang.toLowerCase() === lang.toLowerCase() && v.localService);
  if (!voice) { report(`${lang} local system voice unavailable. Continue with text practice.`); return; }
  const utterance = new SpeechSynthesisUtterance(text); utterance.lang = lang; utterance.voice = voice; utterance.rate = 0.9;
  utterance.onerror = () => report('System audio unavailable. Continue with text practice.');
  speechSynthesis.cancel(); speechSynthesis.speak(utterance);
  report(`System TTS (${lang}); availability depends on installed local voices. Not recorded native audio.`);
}
