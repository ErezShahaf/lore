import pino from 'pino'
import pretty from 'pino-pretty'

const isDev = process.env.NODE_ENV !== 'production'

const destination = isDev
  ? pretty({
      colorize: true,
      translateTime: 'SYS:HH:MM:ss',
      ignore: 'pid,hostname',
      singleLine: false,
    })
  : undefined

export const logger = pino(
  {
    level: isDev ? 'debug' : 'silent',
  },
  destination,
)
