'use strict';

function cloneSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return {};
  }
  return JSON.parse(JSON.stringify(settings));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeCommand(command) {
  return String(command || '').replace(/\\/g, '/');
}

function commandMatchesPromptfluff(command) {
  const normalized = normalizeCommand(command);
  return /(^|[/\s"'])promptfluff\/hook\.js($|[\s"'])/.test(normalized);
}

function hookMatches(hook, matcher) {
  if (!isPlainObject(hook)) {
    return false;
  }
  if (typeof matcher === 'function') {
    return matcher(hook.command, hook);
  }
  if (typeof matcher === 'string') {
    return hook.command === matcher || commandMatchesPromptfluff(hook.command);
  }
  return commandMatchesPromptfluff(hook.command);
}

function userPromptGroups(settings) {
  return settings &&
    settings.hooks &&
    Array.isArray(settings.hooks.UserPromptSubmit)
    ? settings.hooks.UserPromptSubmit
    : [];
}

function hasPromptfluffHook(settings) {
  return userPromptGroups(settings).some((group) =>
    isPlainObject(group) &&
    Array.isArray(group.hooks) &&
    group.hooks.some((hook) => hookMatches(hook))
  );
}

function mergeHook(settings, command) {
  const next = cloneSettings(settings);
  if (!isPlainObject(next.hooks)) {
    next.hooks = {};
  }
  if (!Array.isArray(next.hooks.UserPromptSubmit)) {
    next.hooks.UserPromptSubmit = [];
  }

  for (const group of next.hooks.UserPromptSubmit) {
    if (!isPlainObject(group) || !Array.isArray(group.hooks)) {
      continue;
    }
    const existing = group.hooks.find((hook) => hookMatches(hook));
    if (existing) {
      existing.type = 'command';
      existing.command = command;
      existing.timeout = 5;
      return next;
    }
  }

  next.hooks.UserPromptSubmit.push({
    hooks: [
      {
        type: 'command',
        command,
        timeout: 5
      }
    ]
  });
  return next;
}

function removeHook(settings, matcher) {
  const next = cloneSettings(settings);
  if (!isPlainObject(next.hooks) || !Array.isArray(next.hooks.UserPromptSubmit)) {
    return next;
  }

  const groups = [];
  for (const group of next.hooks.UserPromptSubmit) {
    if (!isPlainObject(group) || !Array.isArray(group.hooks)) {
      groups.push(group);
      continue;
    }
    const hooks = group.hooks.filter((hook) => !hookMatches(hook, matcher));
    if (hooks.length > 0) {
      groups.push({ ...group, hooks });
    }
  }

  if (groups.length > 0) {
    next.hooks.UserPromptSubmit = groups;
  } else {
    delete next.hooks.UserPromptSubmit;
  }

  if (Object.keys(next.hooks).length === 0) {
    delete next.hooks;
  }

  return next;
}

module.exports = {
  cloneSettings,
  commandMatchesPromptfluff,
  hasPromptfluffHook,
  mergeHook,
  removeHook
};
