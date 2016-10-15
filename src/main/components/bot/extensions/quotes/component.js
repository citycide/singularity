import moment from 'moment'

const quotes = {
  async add (quote) {
    if (!$.is.object(quote) || !quote.hasOwnProperty('message')) return false

    const obj = Object.assign({}, {
      credit: $.channel.name,
      submitter: '',
      date: moment().format('L'),
      game: $.stream.game || ''
    }, quote)

    await $.db.set('quotes', {
      message: sanitizeText(obj.message),
      credit: obj.credit,
      submitter: obj.submitter,
      date: obj.date,
      game: obj.game
    })

    const result = await $.db.getRow('quotes', obj)
    return result ? result.id : false
  },
  async get (id) {
    if (!$.is.number(id)) return false

    const response = await $.db.getRow('quotes', { id })
    return $.is.object(response) ? response : null
  },
  async remove (id) {
    if (!$.is.number(id)) return false

    await $.db.del('quotes', { id })

    return !await $.db.exists('quotes', { id })
  },
  async modify (id, newData) {
    if (!$.is.number(id) || !$.is.object(newData)) return false

    await $.db.set('quotes', newData, { id })

    return await $.db.exists('quotes', { id })
  }
}

function sanitizeText (str) {
  // remove surrounding double quotes
  // @DEV: if this pattern has issues try this one:
  // /^"(.+(?="$))"$/g
  if (str.match(/^"(.*)"$/g)) {
    str = str.replace(/^"(.*)"$/g, '$1')
  }

  return str
}

export default async function ($) {
  $.quote = {
    add: quotes.add,
    get: quotes.get,
    modify: quotes.modify,
    remove: quotes.remove
  }

  await $.db.addTableCustom('quotes', [
    { name: 'id', type: 'integer', primary: true, increments: true },
    'message', 'credit', 'submitter', 'date', 'game'
  ])
}
