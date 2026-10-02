import { describe, expect, it } from 'vitest';
import { BOT_COMMAND_SECTIONS, COMMANDS_ALLOWED_WHILE_MUTED, parseChatCommand } from '@/lib/bot-commands';

describe('parseChatCommand', () => {
  it('resolves commands and aliases case-insensitively', () => {
    expect(parseChatCommand('!BJ')).toMatchObject({ id: 'bj', args: [] });
    expect(parseChatCommand('!h')).toMatchObject({ id: 'hit' });
    expect(parseChatCommand('!rbet red 50')).toMatchObject({ id: 'rbet', args: ['red', '50'] });
    expect(parseChatCommand('  !give @homie 50 ')).toMatchObject({ id: 'give', args: ['@homie', '50'] });
    expect(parseChatCommand('!nowplaying')).toMatchObject({ id: 'np' });
  });

  it('ignores normal chat and unknown commands', () => {
    expect(parseChatCommand('elroy hi')).toBeNull();
    expect(parseChatCommand('!notacommand')).toBeNull();
    expect(parseChatCommand('!polling')).toBeNull();
  });

  it('has no duplicate triggers across the docs table', () => {
    const seen = new Map<string, string>();
    for (const section of BOT_COMMAND_SECTIONS) {
      for (const cmd of section.commands) {
        if (!cmd.id) continue;
        for (const trigger of [cmd.command, ...(cmd.aliases ?? [])]) {
          expect(seen.get(trigger), `${trigger} is claimed twice`).toBeUndefined();
          seen.set(trigger, cmd.id);
        }
      }
    }
  });

  it('only lets production toggles through a full mute', () => {
    expect([...COMMANDS_ALLOWED_WHILE_MUTED].sort()).toEqual(['captions', 'ding', 'elroyoff', 'voice', 'volume']);
  });
});
