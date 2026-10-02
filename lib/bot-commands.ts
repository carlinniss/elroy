export type BotCommandAudience = 'everyone' | 'mod';

/**
 * Every chat command Elroy handles. The overlay's dispatcher switches on this union, so adding an
 * id here without a handler (or a handler without a docs entry) is a compile error.
 */
export type BotCommandId =
  | 'aboutme' | 'quota' | 'commands'
  | 'trivia' | 'leaderboard'
  | 'chips' | 'bjtop' | 'loan' | 'debt' | 'give' | 'season'
  | 'bj' | 'bet' | 'hit' | 'stand' | 'double' | 'table' | 'dare' | 'bjstop'
  | 'roulette' | 'rbet' | 'rtable' | 'rstop'
  | 'pick3' | 'pick4' | 'p3bet' | 'p4bet' | 'p3table' | 'p4table' | 'p3stop' | 'p4stop'
  | 'stream' | 'np'
  | 'sr' | 'queue' | 'wrongsong' | 'srremove' | 'skip' | 'srclear'
  | 'clip' | 'poll' | 'ding' | 'captions' | 'voice' | 'volume' | 'elroyoff';

export type BotCommand = {
  /** Omit only for documentation rows that aren't typed commands (e.g. "Mention Elroy"). */
  id?: BotCommandId;
  command: string;
  aliases?: string[];
  description: string;
  audience?: BotCommandAudience;
  example?: string;
};

export type BotCommandSection = {
  id: string;
  title: string;
  summary?: string;
  commands: BotCommand[];
};

export const BOT_COMMANDS_PAGE_PATH = '/commands';

export const BOT_COMMAND_SECTIONS: BotCommandSection[] = [
  {
    id: 'elroy',
    title: 'Talk to Elroy',
    summary: 'Say his name in chat — Elroy is listening and will respond. Voice plays when quota and settings allow.',
    commands: [
      {
        command: 'Mention Elroy',
        description: 'Any time you mention Elroy in chat, he responds (voice too when enabled). Ask about the stream title, game, or Spotify.',
        example: 'Elroy what game are we on?',
      },
      {
        id: 'aboutme', command: '!aboutme',
        description: 'Elroy tells you what he remembers — trivia wins, subs, mentions, follow tenure.',
      },
      {
        id: 'quota', command: '!quota',
        description: 'Show remaining ElevenLabs voice character quota.',
      },
      {
        id: 'commands', command: '!commands',
        aliases: ['!cmds', '!help'],
        description: 'Post the link to this full command list in chat.',
      },
    ],
  },
  {
    id: 'trivia',
    title: 'Trivia & leaderboards',
    summary: 'Trivia is off by default — type !trivia in chat to start a round (5-minute answer window with hints).',
    commands: [
      {
        id: 'trivia', command: '!trivia',
        description: 'Start a trivia round while live. Optional category: cannabis, freaky, or music90s.',
        example: '!trivia · !trivia music90s',
      },
      {
        id: 'leaderboard', command: '!leaderboard',
        aliases: ['!lb'],
        description: 'Show trivia leaders (cannabis, freaky, 90s music).',
      },
      {
        id: 'season',
        command: '!season',
        description: "This month's trivia season standings — all categories, resets on the 1st.",
      },
    ],
  },
  {
    id: 'chips',
    title: 'OG chips (shared bankroll)',
    summary: 'Everyone starts with 1000 play-money chips. Blackjack, roulette, and Pick 3/4 share the same balance.',
    commands: [
      {
        id: 'chips', command: '!chips',
        description: 'Your current chip balance.',
      },
      {
        id: 'bjtop', command: '!bjtop',
        aliases: ['!bjlb'],
        description: 'Chip high-roller leaderboard.',
      },
      {
        id: 'loan', command: '!loan',
        description: '+400 chips, +600 debt. Stackable — Elroy publicly roasts you each time.',
      },
      {
        id: 'debt', command: '!debt',
        description: 'See outstanding loan debt (auto-collected from future winnings).',
      },
      {
        id: 'give',
        command: '!give',
        description: 'Slide chips to another viewer (10–200, once a minute, not while you owe loan debt).',
        example: '!give @homie 50',
      },
    ],
  },
  {
    id: 'blackjack',
    title: 'Blackjack',
    summary: 'Single table — !bj to open or sit, then !bet during the betting window.',
    commands: [
      { id: 'bj', command: '!bj', aliases: ['!blackjack'], description: 'Open the table or take a seat.' },
      { id: 'bet', command: '!bet', description: 'Bet during the betting window (min 10).', example: '!bet 50 · !bet all' },
      { id: 'hit', command: '!hit', aliases: ['!h'], description: 'Draw a card on your turn.' },
      { id: 'stand', command: '!stand', aliases: ['!s'], description: 'Hold your hand on your turn.' },
      { id: 'double', command: '!double', aliases: ['!dd'], description: 'Double down on your first two cards only.' },
      { id: 'table', command: '!table', aliases: ['!bjtable'], description: 'Current table status.' },
      {
        id: 'dare', command: '!dare',
        description: 'Shame ritual for +120 chips when broke (20 min cooldown). Type the assigned line + emotes in chat.',
      },
      { id: 'bjstop', command: '!bjstop', description: 'Cancel table and refund bets.', audience: 'mod' },
    ],
  },
  {
    id: 'roulette',
    title: 'Roulette',
    summary: '!roulette opens 45 seconds of betting — one bet per player per round.',
    commands: [
      { id: 'roulette', command: '!roulette', aliases: ['!spin'], description: 'Open the wheel for betting.' },
      {
        id: 'rbet', command: '!rbet',
        description: 'Bet on red, black, odd, even, or a number 0–36.',
        example: '!rbet red 50 · !rbet 17 100',
      },
      { id: 'rtable', command: '!rtable', aliases: ['!rstatus'], description: 'Roulette round status.' },
      { id: 'rstop', command: '!rstop', description: 'Cancel round and refund bets.', audience: 'mod' },
    ],
  },
  {
    id: 'pick',
    title: 'Pick 3 & Pick 4',
    summary: '60-second betting rounds. Up to 5 bets per player. Combo costs 2× the listed amount.',
    commands: [
      { id: 'pick3', command: '!pick3', aliases: ['!p3'], description: 'Open Pick 3 betting.' },
      { id: 'pick4', command: '!pick4', aliases: ['!p4'], description: 'Open Pick 4 betting.' },
      {
        id: 'p3bet', command: '!p3bet',
        description: 'Pick 3 bet: straight, box, combo, front pair, or back pair.',
        example: '!p3bet straight 420 50 · !p3bet box 247 25',
      },
      {
        id: 'p4bet', command: '!p4bet',
        description: 'Pick 4 bet — adds mid pair.',
        example: '!p4bet straight 1234 25 · !p4bet mid 23 30',
      },
      { id: 'p3table', command: '!p3table', aliases: ['!pick3table'], description: 'Pick 3 status.' },
      { id: 'p4table', command: '!p4table', aliases: ['!pick4table'], description: 'Pick 4 status.' },
      { id: 'p3stop', command: '!p3stop', aliases: ['!pick3stop'], description: 'Cancel Pick 3 and refund.', audience: 'mod' },
      { id: 'p4stop', command: '!p4stop', aliases: ['!pick4stop'], description: 'Cancel Pick 4 and refund.', audience: 'mod' },
    ],
  },
  {
    id: 'stream',
    title: 'Stream & Spotify',
    commands: [
      {
        id: 'stream', command: '!stream',
        aliases: ['!title', '!game', '!category'],
        description: 'Current stream title and game/category.',
      },
      {
        id: 'np', command: '!np',
        aliases: ['!nowplaying', '!song'],
        description: 'Elroy reacts to the current Spotify track (when connected).',
      },
    ],
  },
  {
    id: 'songs',
    title: 'Song requests (Spotify)',
    summary: 'Request songs into the stream music. Mods get the most requests, then VIPs, subs, and followers — brand-new viewers get one at a time.',
    commands: [
      {
        id: 'sr',
        command: '!sr',
        aliases: ['!songrequest'],
        description: 'Request a song by name or Spotify track link. Mods can turn requests on/off with !sr on / !sr off.',
        example: '!sr Nuthin but a G Thang · !sr https://open.spotify.com/track/…',
      },
      { id: 'queue', command: '!queue', aliases: ['!songlist', '!sq'], description: 'See what\'s up next (🔒 = already sent to Spotify).' },
      { id: 'wrongsong', command: '!wrongsong', description: 'Take back your most recent request.' },
      { id: 'srremove', command: '!srremove', description: 'Remove a request by its number in !queue, or all of a viewer\'s requests.', audience: 'mod', example: '!srremove 2 · !srremove @someone' },
      { id: 'skip', command: '!skip', aliases: ['!skipsong'], description: 'Skip the song that\'s playing.', audience: 'mod' },
      { id: 'srclear', command: '!srclear', description: 'Clear every waiting request.', audience: 'mod' },
    ],
  },
  {
    id: 'mod',
    title: 'Mod & production',
    commands: [
      { id: 'clip', command: '!clip', aliases: ['!clipthat'], description: 'Create a Twitch clip (must be live).' },
      {
        id: 'poll', command: '!poll',
        description: 'Start a channel poll.',
        audience: 'mod',
        example: '!poll Best strain? | OG Kush | Blue Dream',
      },
      { id: 'ding', command: '!ding', aliases: ['!gong'], description: 'Toggle bong rip before voice.', audience: 'mod' },
      { id: 'captions', command: '!captions', aliases: ['!cc'], description: 'Turn the on-screen captions on or off.', audience: 'mod', example: '!captions off · !captions on' },
      { id: 'voice', command: '!voice', description: 'Toggle voice on/off (chat stays on).', audience: 'mod' },
      {
        id: 'volume', command: '!volume',
        description: 'Read or set playback volume.',
        audience: 'mod',
        example: '!volume · !volume 50 · !volume +10',
      },
      { id: 'elroyoff', command: '!elroyoff', description: 'Disconnect Elroy from chat.', audience: 'mod' },
    ],
  },
];

/** Commands mods/broadcaster can still run while a "Shut Elroy Up" full mute is active. */
export const COMMANDS_ALLOWED_WHILE_MUTED = new Set<BotCommandId>(['ding', 'captions', 'voice', 'volume', 'elroyoff']);

const COMMAND_LOOKUP: Map<string, BotCommandId> = (() => {
  const map = new Map<string, BotCommandId>();
  for (const section of BOT_COMMAND_SECTIONS) {
    for (const cmd of section.commands) {
      if (!cmd.id) continue;
      for (const name of [cmd.command, ...(cmd.aliases ?? [])]) {
        map.set(name.toLowerCase(), cmd.id);
      }
    }
  }
  return map;
})();

export type ParsedChatCommand = {
  id: BotCommandId;
  /** The trigger as typed, lowercased (e.g. "!h" for the hit alias). */
  trigger: string;
  /** Whitespace-split arguments after the trigger. */
  args: string[];
};

/** Resolve "!rbet red 50" → { id: 'rbet', args: ['red', '50'] } using the documented table. */
export function parseChatCommand(message: string): ParsedChatCommand | null {
  const trimmed = message.trim();
  if (!trimmed.startsWith('!')) return null;
  const [head, ...args] = trimmed.split(/\s+/);
  const trigger = head!.toLowerCase();
  const id = COMMAND_LOOKUP.get(trigger);
  return id ? { id, trigger, args } : null;
}

export function formatCommandLabel(command: BotCommand): string {
  if (!command.aliases?.length) return command.command;
  return `${command.command} (${command.aliases.join(', ')})`;
}

export function countBotCommands(audience: 'all' | BotCommandAudience = 'all'): number {
  return BOT_COMMAND_SECTIONS.reduce((total, section) => {
    const cmds = audience === 'all'
      ? section.commands
      : section.commands.filter((cmd) => (cmd.audience ?? 'everyone') === audience);
    return total + cmds.length;
  }, 0);
}

export function buildCommandsPageUrl(origin?: string): string {
  const base = origin?.replace(/\/$/, '') || '';
  return base ? `${base}${BOT_COMMANDS_PAGE_PATH}` : BOT_COMMANDS_PAGE_PATH;
}

const CHAT_HELP_TEASERS = [
  (url: string) => `📖 Full Elroy command list (${countBotCommands()} cmds): ${url}`,
  (url: string) => `🎮 Games, trivia, chips & mod tools — see every command at ${url}`,
  (url: string) => `📋 New here? Type !commands or open ${url}`,
  (url: string) => `🃏 Blackjack · roulette · Pick 3/4 · !trivia on demand — all commands: ${url}`,
];

export function buildPeriodicCommandHelpMessage(url: string, index: number): string {
  const fn = CHAT_HELP_TEASERS[index % CHAT_HELP_TEASERS.length]!;
  return fn(url);
}

export function buildCommandsChatReply(username: string, url: string): string {
  return `@${username} every command → ${url} (or bookmark it — we post the link every few minutes while live)`;
}
