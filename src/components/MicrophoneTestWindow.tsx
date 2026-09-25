import { useEffect, useRef, useState } from 'react';
import { Mic, X } from 'lucide-react';
import { MicrophoneCheck } from './MicrophoneCheck';

export function MicrophoneTestWindow() {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open)
      panel.current
        ?.querySelector<HTMLButtonElement>('#microphone-setup-action')
        ?.focus({ preventScroll: true });
  }, [open]);
  function close() {
    setOpen(false);
    launcher.current?.focus({ preventScroll: true });
  }
  return (
    <section
      ref={panel}
      className="microphone-test-card"
      aria-label="Microphone test"
      onKeyDown={(event) => {
        if (open && event.key === 'Escape') {
          event.preventDefault();
          close();
        }
      }}
    >
      <div className="panel-heading">
        <Mic size={18} />
        <h2>Microphone test</h2>
        {open && (
          <button className="icon-button" aria-label="Close microphone test" onClick={close}>
            <X size={16} />
          </button>
        )}
      </div>
      <p className="hint">Check your input before a conversation.</p>
      <button
        ref={launcher}
        id="microphone-test-launcher"
        className="secondary-button"
        aria-expanded={open}
        aria-controls="microphone-test-content"
        onClick={() => (open ? close() : setOpen(true))}
      >
        {open ? 'Hide microphone test' : 'Test microphone'}
      </button>
      {open && (
        <div id="microphone-test-content">
          <MicrophoneCheck compact />
        </div>
      )}
    </section>
  );
}
