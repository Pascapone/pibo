# Live Recording Waveform Validation

**Date:** August 23, 2026  
**Target:** Pibo2 public Chat Web UI  
**Candidate:** `pr542-chatgpt-transcription`  
**Code commit:** `c8df5be32a4bac61f66df1ef98a19f6698917933`  
**Bundle:** `assets/index-wTf_YzEt.js`

## Result

Passed. While MediaRecorder was active, Chat Web displayed a separate pill-shaped waveform directly above the composer input. The waveform updated from live Web Audio amplitude, retained at most the latest three seconds, remained usable at desktop and 390-pixel mobile widths, and disappeared cleanly when recording stopped.

## Method

The authenticated Pibo2 page was opened in the persistent headful Chrome browser. A deterministic oscillator-backed `MediaStream` was supplied through `getUserMedia`, allowing repeatable amplitude changes while exercising the production `MediaRecorder`, `AudioContext`, analyser, rendering, and cleanup paths. The transcription response was mocked only for the final stop action so validation would not spend subscription transcription capacity on synthetic tones.

## Evidence

### Desktop

- The deployed page loaded `assets/index-wTf_YzEt.js`.
- After 3.6 seconds, the waveform reported `data-window-ms="3000"` and 57 retained samples; the implementation limit is 60 samples at 50 ms each.
- Recent bar heights varied from 3 to 20 SVG units in response to the changing source amplitude.
- Computed border radius was effectively fully rounded (`33,554,400px`).
- The waveform bottom was at 940 px and the input top at 948 px, confirming an 8 px gap and placement outside the input.
- Screenshot: `/tmp/pibo-recording-waveform-desktop.png`.

### Mobile

- Chrome device emulation used an exact 390 × 844 viewport with mobile and touch enabled.
- The waveform remained fully visible at 374 × 48 px.
- It retained 58 samples after more than three seconds.
- Its bottom was at 750 px and the input top at 758 px, preserving the 8 px separation above the input.
- Screenshot: `/tmp/pibo-recording-waveform-mobile-390.png`.

### Stop and cleanup

- Stopping recording removed the waveform.
- The microphone stream track reached `ended`.
- The mocked transcript appended after the existing draft with paragraph separation.
- One transcription request and zero chat-message requests were observed, confirming no automatic send.
- Headful Chrome reported no console warnings or errors.

## Automated checks

The following passed before deployment:

```text
npm run typecheck
npm run build
node --test test/chat-ui-composer-waveform.test.mjs test/chat-ui-composer-transcription.test.mjs test/chat-ui-composer-sizing.test.mjs
npm test
```

The full suite completed with **1,875 passed, 0 failed**.
