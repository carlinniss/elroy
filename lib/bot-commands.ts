export type BotCommandAudience = 'everyone' | 'mod';

export type BotCommand = {
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
    summary: 'Mention @elroy in chat for banter. Voice plays when quota and settings allow.',
    commands: [
      {
        command: '@elroy',
        description: 'Get a chat reply (and voice when enabled). Ask about the stream title, game, or Spotify.',
        example: '@elroy what game are we on?',
      },
      {
        command: '!aboutme',
        description: 'Elroy tells you what he remembers — trivia wins, subs, mentions, follow tenure.',
      },
      {
        command: '!quota',
        description: 'Show remaining ElevenLabs voice character quota.',
      },
      {
        command: '!commands',
        aliases: ['!cmds', '!help'],
        description: 'Post the link to this full command list in chat.',
      },
    ],
  },
  {
    id: 'trivia',
    title: 'Trivia & leaderboards',
    summary: 'Automatic trivia every 30 minutes while live (first round ~12 min after go-live). 5-minute answer window with hints.',
    commands: [
      {
        command: '!leaderboard',
        aliases: ['!lb'],
        description: 'Show trivia leaders (cannabis, freaky, 90s music).',
      },
    ],
  },
  {
    id: 'chips',
    title: 'OG chips (shared bankroll)',
    summary: 'Everyone starts with 1000 play-money chips. Blackjack, roulette, and Pick 3/4 share the same balance.',
    commands: [
      {
        command: '!chips',
        description: 'Your current chip balance.',
      },
      {
        command: '!bjtop',
        aliases: ['!bjlb'],
        description: 'Chip high-roller leaderboard.',
      },
      {
        command: '!loan',
        description: '+400 chips, +600 debt. Stackable — Elroy publicly roasts you each time.',
      },
      {
        command: '!debt',
        description: 'See outstanding loan debt (auto-collected from future winnings).',
      },
    ],
  },
  {
    id: 'blackjack',
    title: 'Blackjack',
    summary: 'Single table — !bj to open or sit, then !bet during the betting window.',
    commands: [
      { command: '!bj', aliases: ['!blackjack'], description: 'Open the table or take a seat.' },
      { command: '!bet', description: 'Bet during the betting window (min 10).', example: '!bet 50 · !bet all' },
      { command: '!hit', aliases: ['!h'], description: 'Draw a card on your turn.' },
      { command: '!stand', aliases: ['!s'], description: 'Hold your hand on your turn.' },
      { command: '!double', aliases: ['!dd'], description: 'Double down on your first two cards only.' },
      { command: '!table', aliases: ['!bjtable'], description: 'Current table status.' },
      {
        command: '!dare',
        description: 'Shame ritual for +120 chips when broke (20 min cooldown). Type the assigned line + emotes in chat.',
      },
      { command: '!bjstop', description: 'Cancel table and refund bets.', audience: 'mod' },
    ],
  },
  {
    id: 'roulette',
    title: 'Roulette',
    summary: '!roulette opens 45 seconds of betting — one bet per player per round.',
    commands: [
      { command: '!roulette', aliases: ['!spin'], description: 'Open the wheel for betting.' },
      {
        command: '!rbet',
        description: 'Bet on red, black, odd, even, or a number 0–36.',
        example: '!rbet red 50 · !rbet 17 100',
      },
      { command: '!rtable', aliases: ['!rstatus'], description: 'Roulette round status.' },
      { command: '!rstop', description: 'Cancel round and refund bets.', audience: 'mod' },
    ],
  },
  {
    id: 'pick',
    title: 'Pick 3 & Pick 4',
    summary: '60-second betting rounds. Up to 5 bets per player. Combo costs 2× the listed amount.',
    commands: [
      { command: '!pick3', aliases: ['!p3'], description: 'Open Pick 3 betting.' },
      { command: '!pick4', aliases: ['!p4'], description: 'Open Pick 4 betting.' },
      {
        command: '!p3bet',
        description: 'Pick 3 bet: straight, box, combo, front pair, or back pair.',
        example: '!p3bet straight 420 50 · !p3bet box 247 25',
      },
      {
        command: '!p4bet',
        description: 'Pick 4 bet — adds mid pair.',
        example: '!p4bet straight 1234 25 · !p4bet mid 23 30',
      },
      { command: '!p3table', aliases: ['!pick3table'], description: 'Pick 3 status.' },
      { command: '!p4table', aliases: ['!pick4table'], description: 'Pick 4 status.' },
      { command: '!p3stop', aliases: ['!pick3stop'], description: 'Cancel Pick 3 and refund.', audience: 'mod' },
      { command: '!p4stop', aliases: ['!pick4stop'], description: 'Cancel Pick 4 and refund.', audience: 'mod' },
    ],
  },
  {
    id: 'stream',
    title: 'Stream & Spotify',
    commands: [
      {
        command: '!stream',
        aliases: ['!title', '!game', '!category'],
        description: 'Current stream title and game/category.',
      },
      {
        command: '!np',
        aliases: ['!nowplaying', '!song'],
        description: 'Elroy reacts to the current Spotify track (when connected).',
      },
    ],
  },
  {
    id: 'mod',
    title: 'Mod & production',
    commands: [
      { command: '!clip', aliases: ['!clipthat'], description: 'Create a Twitch clip (must be live).' },
      {
        command: '!poll',
        description: 'Start a channel poll.',
        audience: 'mod',
        example: '!poll Best strain? | OG Kush | Blue Dream',
      },
      { command: '!ding', aliases: ['!gong'], description: 'Toggle bong rip before voice.', audience: 'mod' },
      { command: '!voice', description: 'Toggle voice on/off (chat stays on).', audience: 'mod' },
      {
        command: '!volume',
        description: 'Read or set playback volume.',
        audience: 'mod',
        example: '!volume · !volume 50 · !volume +10',
      },
      { command: '!elroyoff', description: 'Disconnect Elroy from chat.', audience: 'mod' },
    ],
  },
];

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
  (url: string) => `🃏 Blackjack · roulette · Pick 3/4 · trivia — all commands: ${url}`,
];

export function buildPeriodicCommandHelpMessage(url: string, index: number): string {
  const fn = CHAT_HELP_TEASERS[index % CHAT_HELP_TEASERS.length]!;
  return fn(url);
}

export function buildCommandsChatReply(username: string, url: string): string {
  return `@${username} every command → ${url} (or bookmark it — we post the link every few minutes while live)`;
}
