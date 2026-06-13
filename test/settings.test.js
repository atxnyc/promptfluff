'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  commandMatchesPromptfluff,
  hasPromptfluffHook,
  mergeHook,
  removeHook
} = require('../src/settings');

const COMMAND = 'node "/tmp/home/.claude/hooks/promptfluff/hook.js"';
const OTHER_COMMAND = 'node "/tmp/home/.claude/hooks/not-promptfluff/hook.js"';

function countPromptfluffHooks(settings) {
  const groups = settings.hooks?.UserPromptSubmit || [];
  return groups.reduce((count, group) => {
    return count + (group.hooks || []).filter((hook) => commandMatchesPromptfluff(hook.command)).length;
  }, 0);
}

test('mergeHook creates the UserPromptSubmit hook shape', () => {
  assert.deepEqual(mergeHook({}, COMMAND), {
    hooks: {
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: 'command',
              command: COMMAND,
              timeout: 5
            }
          ]
        }
      ]
    }
  });
});

test('mergeHook preserves unrelated top-level keys and hooks', () => {
  const original = {
    theme: 'dark',
    hooks: {
      Stop: [
        {
          hooks: [{ type: 'command', command: 'node stop.js', timeout: 2 }]
        }
      ]
    }
  };

  const merged = mergeHook(original, COMMAND);

  assert.equal(merged.theme, 'dark');
  assert.deepEqual(merged.hooks.Stop, original.hooks.Stop);
  assert.equal(hasPromptfluffHook(merged), true);
  assert.deepEqual(original, {
    theme: 'dark',
    hooks: {
      Stop: [
        {
          hooks: [{ type: 'command', command: 'node stop.js', timeout: 2 }]
        }
      ]
    }
  });
});

test('mergeHook keeps unrelated UserPromptSubmit groups in order', () => {
  const existingGroup = {
    matcher: 'keep',
    hooks: [{ type: 'command', command: OTHER_COMMAND, timeout: 5 }]
  };
  const merged = mergeHook({ hooks: { UserPromptSubmit: [existingGroup] } }, COMMAND);

  assert.equal(merged.hooks.UserPromptSubmit.length, 2);
  assert.deepEqual(merged.hooks.UserPromptSubmit[0], existingGroup);
  assert.equal(countPromptfluffHooks(merged), 1);
});

test('mergeHook is idempotent and updates an old promptfluff command without duplicating', () => {
  const first = mergeHook({}, 'node "/old/path/hooks/promptfluff/hook.js"');
  const second = mergeHook(first, COMMAND);
  const third = mergeHook(second, COMMAND);

  assert.equal(countPromptfluffHooks(second), 1);
  assert.equal(countPromptfluffHooks(third), 1);
  assert.equal(second.hooks.UserPromptSubmit[0].hooks[0].command, COMMAND);
  assert.deepEqual(second, third);
});

test('removeHook removes only promptfluff hooks and leaves other hooks intact', () => {
  const settings = {
    hooks: {
      UserPromptSubmit: [
        {
          matcher: 'mixed',
          hooks: [
            { type: 'command', command: COMMAND, timeout: 5 },
            { type: 'command', command: OTHER_COMMAND, timeout: 5 }
          ]
        }
      ],
      Stop: [
        {
          hooks: [{ type: 'command', command: 'node stop.js', timeout: 2 }]
        }
      ]
    }
  };

  const removed = removeHook(settings);

  assert.deepEqual(removed, {
    hooks: {
      UserPromptSubmit: [
        {
          matcher: 'mixed',
          hooks: [{ type: 'command', command: OTHER_COMMAND, timeout: 5 }]
        }
      ],
      Stop: [
        {
          hooks: [{ type: 'command', command: 'node stop.js', timeout: 2 }]
        }
      ]
    }
  });
});

test('removeHook drops empty UserPromptSubmit and hooks containers', () => {
  const merged = mergeHook({}, COMMAND);
  assert.deepEqual(removeHook(merged), {});
});

test('removeHook is idempotent', () => {
  const original = {
    hooks: {
      Stop: [{ hooks: [{ type: 'command', command: 'node stop.js' }] }]
    }
  };

  assert.deepEqual(removeHook(original), original);
  assert.deepEqual(removeHook(removeHook(original)), original);
});

test('mergeHook then removeHook returns the original object shape', () => {
  const original = {
    theme: 'system',
    hooks: {
      Stop: [{ hooks: [{ type: 'command', command: 'node stop.js' }] }]
    }
  };

  assert.deepEqual(removeHook(mergeHook(original, COMMAND)), original);
});
