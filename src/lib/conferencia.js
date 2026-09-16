// Conferência entre a biblioteca de PDFs e a lista de contatos.
//
// O casamento é por código extraído do nome do arquivo. Quando os dois lados
// divergem, o PDF fica invisível: não aparece para nenhum cliente e nada é
// dito. Este módulo torna a divergência visível e propõe o par provável.

/**
 * O nome que vem junto do código no arquivo.
 * "XPerformance - 11489450 Diego - Ref.31.08.pdf" -> "Diego"
 */
export function nomeNoArquivo(nomeArquivo, codigo) {
  if (!nomeArquivo || !codigo) return null
  const depois = String(nomeArquivo).split(codigo)[1]
  if (!depois) return null
  const pedaco = depois.split(/\s[-–]\s|\.pdf$/i)[0]
  const limpo = pedaco.replace(/[_\-]+/g, ' ').trim()
  return limpo.length >= 2 ? limpo : null
}

function normalizar(texto) {
  return String(texto ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
}

/**
 * Compara dois códigos e devolve quantos dígitos diferem, quando têm o mesmo
 * comprimento. Um único dígito de diferença é quase sempre erro de digitação
 * no cadastro — vale destacar para o assessor conferir.
 */
export function digitosDiferentes(a, b) {
  const x = String(a ?? ''), y = String(b ?? '')
  if (!x || !y || x.length !== y.length) return null
  let n = 0
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) n++
  return n
}

/**
 * PDFs que não estão servindo a ninguém, com o contato provável.
 * Só sugere quando exatamente UM contato sem PDF tem aquele nome — sugestão
 * ambígua viraria associação errada, que é o erro caro aqui.
 */
export function pdfsSemDono(pdfs, contacts) {
  const codigosDeContato = new Set(
    (contacts || []).map(c => c.client_code).filter(Boolean))
  const contatosComPdf = new Set()

  for (const p of pdfs || []) {
    if (p.contact_id) contatosComPdf.add(p.contact_id)
  }

  const contatosSemPdf = (contacts || []).filter(c =>
    !contatosComPdf.has(c.id) &&
    !(c.client_code && (pdfs || []).some(p => p.client_code === c.client_code)))

  const orfaos = (pdfs || []).filter(p =>
    !p.contact_id && !(p.client_code && codigosDeContato.has(p.client_code)))

  return orfaos.map(pdf => {
    const nome = nomeNoArquivo(pdf.name, pdf.client_code)
    const alvo = nome ? normalizar(nome) : null

    const candidatos = alvo
      ? contatosSemPdf.filter(c => normalizar(c.name).includes(alvo))
      : []

    const sugestao = candidatos.length === 1 ? candidatos[0] : null
    return {
      pdf,
      nomeNoArquivo: nome,
      sugestao,
      candidatos,
      digitosDiferentes: sugestao ? digitosDiferentes(pdf.client_code, sugestao.client_code) : null,
    }
  })
}

/** Contatos com código cadastrado que não receberam PDF nenhum. */
export function contatosSemPdf(pdfs, contacts) {
  const comPdf = new Set((pdfs || []).map(p => p.contact_id).filter(Boolean))
  const codigos = new Set((pdfs || []).map(p => p.client_code).filter(Boolean))
  return (contacts || []).filter(c =>
    c.client_code && !comPdf.has(c.id) && !codigos.has(c.client_code))
}
