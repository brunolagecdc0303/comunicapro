// Guarda de dados sensíveis.
//
// Regra do projeto: CPF (e documentos equivalentes) NUNCA sobem para o banco.
// O acompanhamento identifica o cliente por client_code (código da conta), que
// só faz sentido dentro da própria assessoria e não é um documento pessoal.
//
// Este módulo é a única fonte de verdade sobre "isso parece documento?" —
// usado no import de CSV e nos campos de texto livre do acompanhamento.

// Colunas que não devem ser importadas de jeito nenhum.
const BLOCKED_COLUMNS = [
  'cpf', 'cnpj', 'rg', 'documento', 'doc', 'identidade',
  'nascimento', 'data_nascimento', 'datanascimento',
  'conta_bancaria', 'agencia', 'banco', 'pix',
  'senha', 'password', 'token',
]

// 11 dígitos com ou sem máscara: 123.456.789-01 / 12345678901
const CPF_PATTERN = /(?:^|[^\d])(\d{3}\.\d{3}\.\d{3}-\d{2}|\d{11})(?=$|[^\d])/g

/**
 * Valida os dígitos verificadores de um CPF.
 * Sem isso, qualquer telefone com DDI (5531999998888 = 13 dígitos, ok) ou
 * sequência de 11 dígitos viraria falso positivo — e um telefone brasileiro
 * com DDD tem exatamente 11 dígitos. Só bloqueamos o que é CPF de verdade.
 */
export function isValidCPF(value) {
  const d = String(value ?? '').replace(/\D/g, '')
  if (d.length !== 11) return false
  if (/^(\d)\1{10}$/.test(d)) return false // 000...0, 111...1 etc.

  const check = (len) => {
    let sum = 0
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i)
    const mod = (sum * 10) % 11
    return mod === 10 ? 0 : mod
  }
  return check(9) === Number(d[9]) && check(10) === Number(d[10])
}

/** Encontra CPFs válidos dentro de um texto livre. */
export function findCPFs(text) {
  if (!text) return []
  const found = new Set()
  for (const match of String(text).matchAll(CPF_PATTERN)) {
    if (isValidCPF(match[1])) found.add(match[1])
  }
  return [...found]
}

/** true se o texto contém pelo menos um CPF válido. */
export function containsCPF(text) {
  return findCPFs(text).length > 0
}

/** true se o nome da coluna do CSV é de um campo que não queremos guardar. */
export function isBlockedColumn(columnName) {
  const normalized = String(columnName ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // tira acentos
    .replace(/[^a-z]/g, '')            // "Data de Nascimento" -> "datadenascimento"
  if (!normalized) return false
  return BLOCKED_COLUMNS.some(blocked => normalized.includes(blocked.replace(/_/g, '')))
}

/**
 * Analisa as linhas cruas de um CSV antes de importar.
 * Retorna quais colunas devem ser descartadas e quantas linhas trazem CPF,
 * para o usuário ver o que foi barrado antes de confirmar a importação.
 */
export function auditCSV(rows) {
  if (!rows?.length) return { blockedColumns: [], rowsWithCPF: 0 }

  const columns = Object.keys(rows[0] ?? {})
  const blockedColumns = columns.filter(isBlockedColumn)

  let rowsWithCPF = 0
  for (const row of rows) {
    const hasCPF = Object.entries(row).some(([col, value]) =>
      !blockedColumns.includes(col) && containsCPF(value)
    )
    if (hasCPF) rowsWithCPF++
  }

  return { blockedColumns, rowsWithCPF }
}

/**
 * Remove CPFs de um texto que vai ser salvo, substituindo por [removido].
 * Usado nos campos livres (combinados, observações) como rede de segurança:
 * a UI avisa antes, isto garante que não passa nem se o aviso for ignorado.
 */
export function redactCPFs(text) {
  if (!text) return text
  let out = String(text)
  for (const cpf of findCPFs(out)) {
    out = out.split(cpf).join('[documento removido]')
  }
  return out
}
