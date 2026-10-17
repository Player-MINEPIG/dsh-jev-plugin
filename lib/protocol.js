export function parsePayload(source) {
  if (Buffer.byteLength(source) > 1048576) throw new Error('Jev 协议错误：响应过大')
  let result
  try {result = JSON.parse(source)} catch {throw new Error('Jev 返回内容不是有效的 JSON')}
  let cursor = 0
  const whitespace = () => {while (/\s/.test(source[cursor] ?? '') && cursor < source.length) cursor++}
  const string = () => {const start = cursor++; while (cursor < source.length) {if (source[cursor] === '\\') {cursor += 2; continue} if (source[cursor++] === '"') break} return JSON.parse(source.slice(start,cursor))}
  const visit = depth => {
    if (depth > 64) throw new Error('Jev 协议错误：响应嵌套过深')
    whitespace()
    if (source[cursor] === '{') {
      cursor++; whitespace(); const used = new Set()
      if (source[cursor] === '}') {cursor++; return}
      while (true) {whitespace(); const key = string(); if (used.has(key)) throw new Error('Jev 协议错误：JSON 包含重复字段'); used.add(key); whitespace(); cursor++; visit(depth+1); whitespace(); if (source[cursor++] === '}') break}
    } else if (source[cursor] === '[') {
      cursor++; whitespace(); if (source[cursor] === ']') {cursor++; return}
      while (true) {visit(depth+1); whitespace(); if (source[cursor++] === ']') break}
    } else if (source[cursor] === '"') string()
    else {while(cursor < source.length && !/[\s,}\]]/.test(source[cursor])) cursor++}
  }
  visit(0)
  return result
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const isProbability = value => Number.isFinite(value) && value >= 0 && value <= 1
const sameKeys = (value, keys) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))

function validateProbabilities(value, keys, path) {
  if (!isObject(value) || !sameKeys(value, keys) || Object.values(value).some(n => !isProbability(n))) {
    throw new Error(`Jev 协议错误：${path} 必须包含所有选项，且每项为 0..1 的有限数值`)
  }
  if (Math.abs(Object.values(value).reduce((sum, n) => sum + n, 0) - 1) > 0.02) {
    throw new Error(`Jev 协议错误：${path} 的概率总和必须约等于 1（容差 0.02）`)
  }
}

export function validatePayload(payload, questions) {
  if (!isObject(payload) || !isObject(payload.answers)) throw new Error('Jev 协议错误：缺少 answers 对象')
  if (!sameKeys(payload.answers, Object.keys(questions))) throw new Error('Jev 协议错误：answers 必须与 questions 的问题 ID 完全一致')
  if (payload.model !== undefined && typeof payload.model !== 'string') throw new Error('Jev 协议错误：model 必须是字符串')
  for (const [id, question] of Object.entries(questions)) {
    const answer = payload.answers[id]
    const path = `answers.${id}`
    if (!isObject(answer) || answer.type !== question.type) throw new Error(`Jev 协议错误：${path}.type 与问题类型不一致`)
    if (answer.confidence !== undefined && !isProbability(answer.confidence)) throw new Error(`Jev 协议错误：${path}.confidence 必须为 0..1 的有限数值`)
    if (question.type === 'choice') {
      if (typeof answer.choice !== 'string' || !Object.hasOwn(question.criteria, answer.choice)) throw new Error(`Jev 协议错误：${path}.choice 必须是给定选项 ID`)
      validateProbabilities(answer.probabilities, Object.keys(question.criteria), `${path}.probabilities`)
    } else if (question.type === 'noul') {
      if (!isProbability(answer.noul)) throw new Error(`Jev 协议错误：${path}.noul 必须为 0..1 的有限数值`)
    } else if (question.type === 'score') {
      if (!Number.isFinite(answer.score)) throw new Error(`Jev 协议错误：${path}.score 必须是有限数值`)
      if (answer.probabilities !== undefined) validateProbabilities(answer.probabilities, question.criteria.map((_, i) => String(i)), `${path}.probabilities`)
    }
  }
  if (payload.usage !== undefined && !isObject(payload.usage)) throw new Error('Jev 协议错误：usage 必须是对象')
}
