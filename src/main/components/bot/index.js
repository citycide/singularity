import EventEmitter from 'events'
import Levers from 'levers'
import { isPlainObject } from 'lodash'

import Tock from 'common/utils/Tock'
import db from 'common/components/db'
import util from 'common/utils/helpers'
import log from 'common/utils/logger'

import modules from './components/moduleHandler'
import bot from './bot'

const settings = new Levers('app')
const twitch = new Levers('twitch')

let commandRegistry = null
let registry = null

async function dbExists (table, where) {
  return isPlainObject(await db.bot.data.getRow(table, where))
}

const channel = {
  name: twitch.get('name'),
  botName: settings.get('bot.name')
}

async function say (user, message) {
  if (arguments.length === 1) {
    message = user
    return bot.say(channel.name, message)
  }

  const mention = (await db.bot.settings.get('responseMention', false)) ? '' : `${user}: `

  if (!await db.bot.settings.get('whisperMode', false)) {
    return bot.say(channel.name, `${mention}${message}`)
  } else {
    return bot.whisper(user, message)
  }
}

const whisper = (user, message) => bot.whisper(user, message)
const shout = message => bot.say(channel.name, message)
const getPrefix = async () => await db.bot.settings.get('prefix', '!')
const getModule = cmd => modules.load(registry[cmd].module)
const getRunner = cmd => getModule(cmd)[registry[cmd].handler]

async function commandIsEnabled (cmd, sub) {
  if (!sub) {
    return await db.bot.data.get('commands', 'status', { name: cmd })
  } else {
    return await db.bot.data.get('subcommands', 'status', { name: sub, parent: cmd })
  }
}

function commandExists (cmd, sub) {
  if (!registry.hasOwnProperty(cmd)) return false

  if (!sub) {
    return registry.hasOwnProperty(cmd)
  } else {
    return registry[cmd].subcommands.hasOwnProperty(sub)
  }
}

async function commandEnable (cmd, sub) {
  if (!commandExists(cmd, sub)) {
    log.bot(`ERR in enableCommand:: ${cmd} is not a registered command`)
    return false
  }

  if (sub) {
    await db.bot.data.set('subcommands', { status: true }, { name: sub, parent: cmd })
  } else {
    await db.bot.data.set('commands', { status: true }, { name: cmd })
  }

  return true
}

async function commandDisable (cmd, sub) {
  if (!commandExists(cmd, sub)) {
    log.bot(`ERR in disableCommand:: ${cmd} is not a registered command`)
    return false
  }

  if (sub) {
    await db.bot.data.set('subcommands', { status: false }, { name: sub, parent: cmd })
  } else {
    await db.bot.data.set('commands', { status: false }, { name: cmd })
  }

  return true
}

function commandIsCustom (cmd) {
  if (!commandExists(cmd)) return false
  return registry[cmd].custom
}

async function commandGetPermLevel (cmd, sub) {
  return (sub)
    ? await db.bot.data.get('subcommands', 'permission', { name: sub, parent: cmd })
    : await db.bot.data.get('commands', 'permission', { name: cmd })
}

async function commandSetPermLevel (cmd, level, sub) {
  if (!commandExists(cmd, sub)) {
    log.bot(`ERR in setPermLevel:: ${cmd} is not a registered command`)
    return false
  }

  if (sub) {
    await db.bot.data.set('subcommands', { permission: level }, { name: sub, parent: cmd })
  } else {
    await db.bot.data.set('commands', { permission: level }, { name: cmd })
  }

  return true
}

async function getModuleConfig (moduleName, key, defaultValue) {
  return await db.bot.data.get('extension_settings', 'value', {
    key,
    extension: moduleName,
    type: 'module'
  }, defaultValue)
}

async function setModuleConfig (moduleName, key, value) {
  return await db.bot.data.set('extension_settings', { value }, {
    key,
    extension: moduleName,
    type: 'module'
  })
}

async function getComponentConfig (component, key, defaultValue) {
  return await db.bot.data.get('extension_settings', 'value', {
    key,
    extension: component,
    type: 'component'
  }, defaultValue)
}

async function setComponentConfig (component, key, value) {
  return await db.bot.data.set('extension_settings', { value }, {
    key,
    extension: component,
    type: 'component'
  })
}

async function addTable (name, keyed) {
  if (await db.bot.data.tableExists(name)) return
  if (!name || typeof name !== 'string') {
    log.bot(
      `ERR in core#addTable:: Expected parameter 'name' to be a string, received ${typeof name}`
    )
    return
  }

  const columns = keyed
    ? [{ name: 'id', type: 'integer', primary: true, increments: true }, 'value', 'info']
    : ['key', 'value', 'info']

  await db.addTable(name, columns, true)
}

async function addTableCustom (name, columns) {
  if (await db.bot.data.tableExists(name)) return
  if (arguments.length < 2 || typeof name !== 'string' || !Array.isArray(columns)) {
    log.bot(`ERR in core#addTableCustom:: wrong arguments.`)
    return
  }

  await db.addTable(name, columns, true)
}

const coreMethods = {
  api: bot.api,
  tick: new Tock(),
  util,

  channel,

  say,
  whisper,
  shout,

  command: {
    getPrefix,
    getModule,
    getRunner,
    isEnabled: commandIsEnabled,
    exists: commandExists,
    enable: commandEnable,
    disable: commandDisable,
    isCustom: commandIsCustom,
    getPermLevel: commandGetPermLevel,
    setPermLevel: commandSetPermLevel
  },

  settings: {
    get: db.bot.settings.get,
    set: db.bot.settings.set,
    confirm: db.bot.settings.confirm
  },

  db: {
    get: db.bot.data.get,
    set: db.bot.data.set,
    del: db.bot.data.del,
    confirm: db.bot.data.confirm,
    incr: db.bot.data.incr,
    decr: db.bot.data.decr,
    getRow: db.bot.data.getRow,
    countRows: db.bot.data.countRows,
    exists: dbExists,
    getModuleConfig,
    setModuleConfig,
    getComponentConfig,
    setComponentConfig,
    addTable,
    addTableCustom
  },

  user: {
    isFollower (user) {
      let _status = false
      bot.api({
        url: `https://api.twitch.tv/kraken/users/${user}/follows/channels/${channel.name}`,
        method: 'GET',
        headers: {
          'Accept': 'application/vnd.twitchtv.v3+json',
          'Authorization': `OAuth ${settings.get('twitch.token').slice(6)}`,
          'Client-ID': settings.get('clientID')
        }
      }, (err, res, body) => {
        if (err) log.bot(err)
        _status = (body.status !== 404)
      })

      return _status
    },

    async exists (user) {
      return isPlainObject(await db.bot.data.getRow('users', { name: user }))
    },

    isAdmin (user) {
      return (user === channel.name || user === channel.botName)
    }
  },

  async runCommand (event) {
    // Check if the specified command is registered
    if (!commandExists(event.command)) {
      log.bot(`'${event.command}' is not a registered command`)
      return
    }

    // Check if the specified command is enabled
    if (!commandIsEnabled(event.command)) {
      log.bot(`'${event.command}' is installed but is not enabled`)
      return
    }

    // Check if the first argument is a subcommand
    let subcommand = event.args[0] || undefined
    if (subcommand && commandExists(event.command, subcommand)) {
      // if it is, check if the subcommand is enabled
      if (!commandIsEnabled(event.command, subcommand)) {
        log.bot(`'${event.command} ${subcommand}' is installed but is not enabled`)
        subcommand = undefined
        return
      }

      // add subcommand argument properties to the event object
      event.subcommand = subcommand
      event.subArgs = event.args.slice(1)
      event.subArgString = event.subArgs.join(' ')
    } else {
      subcommand = undefined
    }

    // Check if the specified (sub)command is on cooldown for this user (or globally depending on settings)
    const cooldownActive = await this.command.isOnCooldown(event.command, event.sender, subcommand)
    if (cooldownActive) {
      log.bot(`'${event.command}' is on cooldown for ${event.sender} (${cooldownActive} seconds)`)
      return say(event.sender, `You need to wait ${cooldownActive} seconds to use !${event.command} again.`)
    }

    // Check that the user has sufficient privileges to use the (sub)command
    if (event.groupID > await commandGetPermLevel(event.command, subcommand)) {
      log.bot(`${event.sender} does not have sufficient permissions to use !${event.command}`)
      return say(event.sender, `You don't have what it takes to use !${event.command}.`)
    }

    // Check that the user has enough points to use the (sub)command
    const commandPrice = await this.command.getPrice(event.command, subcommand)
    const userPoints = await this.points.get(event.sender)
    if (userPoints < commandPrice) {
      log.bot(`${event.sender} does not have enough points to use !${event.command}.`)
      return say(event.sender, `You don't have enough points to use !${event.command}. ` +
        `(costs ${commandPrice}, you have ${userPoints})`)
    }

    // Finally, run the (sub)command
    if (commandIsCustom(event.command)) {
      try {
        const response = await db.bot.data.get('commands', 'response', {
          name: event.command, module: 'custom'
        })
        say(event.sender, this.params(event, response))
      } catch (e) {
        log.error(e)
      }
    } else {
      try {
        getRunner(event.command)(event)

        this.command
            .startCooldown(event.command, event.sender, subcommand)
            .catch(e => log.error(e))

        if (!commandPrice) return

        this.points
            .sub(event.sender, commandPrice)
            .catch(e => log.error(e))
      } catch (e) {
        log.error(e)
      }
    }
  }
}

class Core extends EventEmitter {
  constructor () {
    super()
    Object.assign(this, coreMethods)
  }
}
let core = new Core()

global.$ = core
global.core = core

export async function initialize (instant) {
  if (!settings.get('bot.name') || !settings.get('bot.auth')) {
    return log.bot('Bot setup is not complete.')
  }

  await util.sleep(instant ? 1 : 5000)

  log.bot('Initializing bot...')
  if (!core) core = new Core()
  bot.connect()

  await db.initBotDB()

  await loadHelpers()
  await loadTables()
  await loadComponents()

  log.bot('Bot ready.')
  core.emit('bot:ready')

  modules.watcher.start()

  commandRegistry.loadCustomCommands()
}

export function disconnect () {
  log.bot('Deactivating bot...')
  modules.watcher.stop()
  bot.disconnect()
  modules.unload(null, { all: true })
  commandRegistry.unregister(true)
  log.bot('Deactivated bot.')
}

/*
export function reconfigure (name, auth) {
  updateAuth(name, auth)
}
*/

async function loadTables () {
  const arr = ['settings', 'extension_settings', 'users', 'commands', 'subcommands']

  const obj = await arr.reduce(async (p, c) => {
    return { ...await p, [c]: await db.bot.data.tableExists(c) }
  }, {})

  if (!obj['settings']) {
    try {
      await db.addTable('settings', [
        { name: 'key', primary: true },
        'value', 'info'
      ], true)
    } catch (e) {
      log.error(e.message)
    }
  }

  if (!obj['extension_settings']) {
    try {
      await db.addTable('extension_settings', [
        'extension', 'type', 'key', 'value', 'info'
      ], true, { compositeKey: ['extension', 'type', 'key'] })
    } catch (e) {
      log.error(e)
    }
  }

  if (!obj['users']) {
    try {
      await db.addTable('users', [
        { name: 'name', unique: 'inline' },
        { name: 'permission', type: 'integer' },
        { name: 'mod', defaultTo: 'false' },
        { name: 'following', defaultTo: 'false' },
        { name: 'seen', type: 'integer', defaultTo: 0 },
        { name: 'points', type: 'integer', defaultTo: 0 },
        { name: 'time', type: 'integer', defaultTo: 0 },
        { name: 'rank', type: 'integer', defaultTo: 1 }
      ], true)
    } catch (e) {
      log.error(e)
    }
  }

  await db.bot.initSettings().catch(e => log.error(e.message))

  if (!obj['commands']) {
    try {
      await db.addTable('commands', [
        { name: 'name', unique: 'inline' },
        { name: 'cooldown', type: 'integer', defaultTo: 30 },
        { name: 'permission', type: 'integer', defaultTo: 5 },
        { name: 'status', defaultTo: 'false' },
        { name: 'price', type: 'integer', defaultTo: 0 },
        'module', 'response'
      ], true)
    } catch (e) {
      log.error(e)
    }
  }

  if (!obj['subcommands']) {
    try {
      await db.addTable('subcommands', [
        'name',
        { name: 'cooldown', type: 'integer', defaultTo: 30 },
        { name: 'permission', type: 'integer', defaultTo: 5 },
        { name: 'status', defaultTo: 'false' },
        { name: 'price', type: 'integer', defaultTo: 0 },
        'module',
        'parent'
      ], true, { compositeKey: ['name', 'module'] })
    } catch (e) {
      log.error(e)
    }
  }

  return Promise.resolve()
}

function loadHelpers () {
  require('./helpers')
  return Promise.resolve()
}

function loadComponents () {
  commandRegistry = require('./components/commandRegistry')
  registry = commandRegistry.default

  require('./components/twitchapi')
  require('./components/cooldown')
  require('./components/points')
  require('./components/time')
  require('./components/groups')
  require('./components/ranks')
  require('./components/quotes')
  return Promise.resolve()
}