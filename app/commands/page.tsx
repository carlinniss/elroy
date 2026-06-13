import {
  BOT_COMMAND_SECTIONS,
  formatCommandLabel,
  countBotCommands,
  type BotCommand,
} from '@/lib/bot-commands';

function CommandRow({ command }: { command: BotCommand }) {
  const isMod = command.audience === 'mod';

  return (
    <article
      style={{
        padding: '14px 16px',
        borderRadius: 10,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 6 }}>
        <code
          style={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            fontSize: 15,
            fontWeight: 700,
            color: '#7dff9a',
            background: 'rgba(125, 255, 154, 0.1)',
            padding: '3px 8px',
            borderRadius: 6,
          }}
        >
          {formatCommandLabel(command)}
        </code>
        {isMod && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: '#ffb347',
              background: 'rgba(255, 179, 71, 0.12)',
              padding: '2px 8px',
              borderRadius: 999,
            }}
          >
            Mod
          </span>
        )}
      </div>
      <p style={{ margin: 0, lineHeight: 1.5, color: 'rgba(255,255,255,0.82)', fontSize: 15 }}>
        {command.description}
      </p>
      {command.example && (
        <p
          style={{
            margin: '8px 0 0',
            fontSize: 13,
            color: 'rgba(255,255,255,0.5)',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          }}
        >
          e.g. {command.example}
        </p>
      )}
    </article>
  );
}

export default function CommandsPage() {
  const total = countBotCommands();

  return (
    <main
      style={{
        margin: 0,
        padding: '24px 16px 48px',
        maxWidth: 720,
        marginLeft: 'auto',
        marginRight: 'auto',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        color: '#f5f5f5',
        background: 'linear-gradient(165deg, #0d1117 0%, #161b22 45%, #1a1424 100%)',
        minHeight: '100vh',
        boxSizing: 'border-box',
      }}
    >
      <header style={{ marginBottom: 28 }}>
        <p
          style={{
            margin: '0 0 8px',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: '#7dff9a',
          }}
        >
          Elroy Bot
        </p>
        <h1 style={{ margin: '0 0 10px', fontSize: 28, fontWeight: 800, lineHeight: 1.15 }}>
          Chat commands
        </h1>
        <p style={{ margin: 0, lineHeight: 1.55, color: 'rgba(255,255,255,0.65)', fontSize: 15 }}>
          {total} commands — updated live from the bot. Mention <strong style={{ color: '#fff' }}>@elroy</strong>{' '}
          anytime, or type <strong style={{ color: '#fff' }}>!commands</strong> in chat for this link.
        </p>
      </header>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        {BOT_COMMAND_SECTIONS.map((section) => (
          <section key={section.id}>
            <h2
              style={{
                margin: '0 0 6px',
                fontSize: 20,
                fontWeight: 700,
                color: '#fff',
              }}
            >
              {section.title}
            </h2>
            {section.summary && (
              <p style={{ margin: '0 0 12px', fontSize: 14, lineHeight: 1.5, color: 'rgba(255,255,255,0.55)' }}>
                {section.summary}
              </p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {section.commands.map((command) => (
                <CommandRow key={`${section.id}-${command.command}`} command={command} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <footer
        style={{
          marginTop: 36,
          paddingTop: 20,
          borderTop: '1px solid rgba(255,255,255,0.1)',
          fontSize: 13,
          color: 'rgba(255,255,255,0.45)',
          lineHeight: 1.5,
        }}
      >
        While live, Elroy posts this page link in chat every few minutes. Casino games share one 1000-chip bankroll.
      </footer>
    </main>
  );
}
