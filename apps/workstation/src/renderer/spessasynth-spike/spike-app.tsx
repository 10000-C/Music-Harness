import { useEffect, useState, type ChangeEvent } from 'react';
import { createRoot } from 'react-dom/client';

import {
  inspectSpikeMidi,
  inspectSpikeSoundFont,
  parseSpikeMidi,
} from './spike-fixtures.js';
import {
  createGeneratedSpikeInput,
  runSpessaSynthSpike,
  type SpessaSynthSpikeInput,
} from './run-spike.js';
import {
  createRunningSpikeReport,
  normalizeSpikeError,
  type SpessaSynthSpikeReport,
} from './spike-report.js';
import './spike.css';

interface LoadedAsset {
  readonly name: string;
  readonly buffer: ArrayBuffer;
  readonly summary: string;
}

interface SpessaSynthSpikeAppProps {
  readonly initialReport: Promise<SpessaSynthSpikeReport>;
}

const reportFromPromise = (
  promise: Promise<SpessaSynthSpikeReport>,
  setReport: (report: SpessaSynthSpikeReport) => void,
): void => {
  void promise.then(setReport);
};

const SpessaSynthSpikeApp = ({
  initialReport,
}: SpessaSynthSpikeAppProps): React.JSX.Element => {
  const [report, setReport] = useState<SpessaSynthSpikeReport>(() =>
    createRunningSpikeReport('generated'),
  );
  const [midi, setMidi] = useState<LoadedAsset | null>(null);
  const [soundFont, setSoundFont] = useState<LoadedAsset | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);
  useEffect(() => {
    reportFromPromise(initialReport, setReport);
  }, [initialReport]);

  const run = (input: SpessaSynthSpikeInput): void => {
    setReport(createRunningSpikeReport(input.mode));
    reportFromPromise(runSpessaSynthSpike(input), setReport);
  };

  const loadMidi = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0];
    if (file === undefined) return;
    void file
      .arrayBuffer()
      .then((buffer) => {
        const evidence = inspectSpikeMidi(parseSpikeMidi(buffer, file.name));
        const noteCount = evidence.tracks.reduce(
          (total, track) => total + track.notes.length,
          0,
        );
        setMidi({
          name: file.name,
          buffer,
          summary: `${String(evidence.tracks.length)} tracks · ${String(noteCount)} notes`,
        });
        setAssetError(null);
      })
      .catch((error: unknown) => {
        setAssetError(normalizeSpikeError(error));
      });
  };

  const loadSoundFont = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0];
    if (file === undefined) return;
    void file
      .arrayBuffer()
      .then((buffer) => {
        const evidence = inspectSpikeSoundFont(buffer);
        setSoundFont({
          name: file.name,
          buffer,
          summary: `${String(evidence.presetCount)} presets`,
        });
        setAssetError(null);
      })
      .catch((error: unknown) => {
        setAssetError(normalizeSpikeError(error));
      });
  };

  const runImported = (): void => {
    if (midi === null || soundFont === null) return;
    run({
      midiBuffer: midi.buffer,
      soundFontBuffer: soundFont.buffer,
      midiFileName: midi.name,
      mode: 'imported',
    });
  };

  return (
    <main className="spessa-spike" data-status={report.status}>
      <header className="spessa-spike__header">
        <div>
          <p className="spessa-spike__eyebrow">
            Developer B · isolated capability gate
          </p>
          <h1>SpessaSynth Competition Spike</h1>
          <p>
            MIDI/SF2 parsing, channel controls, programmatic edits and real-time
            AudioWorklet playback.
          </p>
        </div>
        <span className={`spessa-spike__status is-${report.status}`}>
          {report.status}
        </span>
      </header>

      <section className="spessa-spike__actions" aria-label="Spike inputs">
        <button
          type="button"
          onClick={() => {
            run(createGeneratedSpikeInput());
          }}
        >
          Run deterministic probe
        </button>
        <label>
          <span>Load MIDI</span>
          <input
            type="file"
            accept=".mid,.midi,audio/midi"
            onChange={loadMidi}
          />
          <small>
            {midi === null
              ? 'No MIDI selected'
              : `${midi.name} · ${midi.summary}`}
          </small>
        </label>
        <label>
          <span>Load SoundFont</span>
          <input type="file" accept=".sf2,.sf3" onChange={loadSoundFont} />
          <small>
            {soundFont === null
              ? 'No SF2/SF3 selected'
              : `${soundFont.name} · ${soundFont.summary}`}
          </small>
        </label>
        <button
          type="button"
          disabled={
            midi === null || soundFont === null || report.status === 'running'
          }
          onClick={runImported}
        >
          Play loaded files
        </button>
        {assetError === null ? null : (
          <p className="spessa-spike__error" role="alert">
            {assetError}
          </p>
        )}
      </section>

      <section className="spessa-spike__results" aria-live="polite">
        <div className="spessa-spike__summary">
          <span>Phase</span>
          <strong>{report.phase}</strong>
          <span>Mode</span>
          <strong>{report.mode}</strong>
          <span>Checks</span>
          <strong>
            {String(
              report.checks.filter((check) => check.status === 'passed').length,
            )}{' '}
            / {String(report.checks.length)}
          </strong>
        </div>
        <ol className="spessa-spike__checks">
          {report.checks.map((check) => (
            <li key={check.id} data-status={check.status}>
              <span>{check.status === 'passed' ? 'PASS' : 'FAIL'}</span>
              <div>
                <strong>{check.id}</strong>
                <p>{check.detail}</p>
              </div>
            </li>
          ))}
        </ol>
        {report.error === undefined ? null : (
          <pre className="spessa-spike__error">{report.error}</pre>
        )}
      </section>
    </main>
  );
};

export const mountSpessaSynthSpike = (
  rootElement: HTMLElement,
): Promise<SpessaSynthSpikeReport> => {
  const initialReport = runSpessaSynthSpike();
  createRoot(rootElement).render(
    <SpessaSynthSpikeApp initialReport={initialReport} />,
  );
  return initialReport;
};
