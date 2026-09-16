// Monta a lista de destinatários a partir de contatos, grupos e PDFs.
//
// Regra central: um contato que pertence a um grupo NÃO aparece também
// sozinho. Se aparecesse, dava para selecionar o grupo e o contato ao mesmo
// tempo e a pessoa receberia a mensagem duas vezes. A exclusão é estrutural,
// não um aviso na tela.

import { extractClientCode } from './clientCode'

/**
 * @returns lista de destinatários:
 *   { id, tipo: 'grupo'|'contato', nome, telefone, contatos[], pdfs[], semTelefone }
 */
export function montarDestinatarios(contacts, groups, pdfs) {
  const pdfPorCodigo = new Map()
  for (const pdf of pdfs || []) {
    if (pdf.client_code) pdfPorCodigo.set(pdf.client_code, pdf)
  }

  const contatoPorId = new Map((contacts || []).map(c => [c.id, c]))
  const pdfDoContato = (c) => (c?.client_code ? pdfPorCodigo.get(c.client_code) || null : null)

  const emGrupo = new Set()
  const destinatarios = []

  for (const g of groups || []) {
    const membros = (g.memberIds || []).map(id => contatoPorId.get(id)).filter(Boolean)
    if (membros.length === 0) continue
    membros.forEach(m => emGrupo.add(m.id))

    const titular = contatoPorId.get(g.primary_contact_id) || membros[0]
    destinatarios.push({
      id: `grupo:${g.id}`,
      tipo: 'grupo',
      grupoId: g.id,
      kind: g.kind,
      nome: g.name,
      titular: titular?.name || '—',
      telefone: titular?.phone || '',
      semTelefone: !titular?.phone,
      contatos: membros,
      pdfs: membros.map(pdfDoContato).filter(Boolean),
    })
  }

  for (const c of contacts || []) {
    if (emGrupo.has(c.id)) continue
    const pdf = pdfDoContato(c)
    destinatarios.push({
      id: `contato:${c.id}`,
      tipo: 'contato',
      contatoId: c.id,
      nome: c.name,
      titular: c.name,
      telefone: c.phone || '',
      semTelefone: !c.phone,
      clientCode: c.client_code || null,
      contatos: [c],
      pdfs: pdf ? [pdf] : [],
    })
  }

  // Grupos primeiro; depois alfabético.
  return destinatarios.sort((a, b) => {
    if (a.tipo !== b.tipo) return a.tipo === 'grupo' ? -1 : 1
    return (a.nome || '').localeCompare(b.nome || '', 'pt-BR')
  })
}

/**
 * Avisos por destinatário — o que faz o assessor parar antes de enviar.
 * Cada aviso é algo que pode resultar em mensagem errada para a pessoa errada.
 */
export function avisosDoDestinatario(d) {
  const avisos = []

  if (d.semTelefone) {
    avisos.push({ nivel: 'erro', texto: 'Sem telefone cadastrado — não é possível enviar.' })
  }

  const contasSemPdf = d.contatos.filter(c => !c.client_code)
  if (contasSemPdf.length > 0 && d.tipo === 'contato') {
    avisos.push({ nivel: 'aviso', texto: 'Contato sem código de cliente, então nenhum PDF será anexado.' })
  }

  const faltando = d.contatos.filter(c => c.client_code).length - d.pdfs.length
  if (faltando > 0) {
    avisos.push({
      nivel: 'aviso',
      texto: `${faltando} conta(s) com código mas sem PDF correspondente — a IA gera sem os dados dessa(s) conta(s).`,
    })
  }

  // O PDF é casado pelo código extraído do nome do arquivo. Se o código do
  // arquivo não bate com o da conta, o cliente receberia o extrato de outro.
  for (const pdf of d.pdfs) {
    const doNome = extractClientCode(pdf.name)
    if (doNome && pdf.client_code && doNome !== pdf.client_code) {
      avisos.push({
        nivel: 'erro',
        texto: `O arquivo "${pdf.name}" está registrado na conta ${pdf.client_code}. Confira antes de enviar.`,
      })
    }
  }

  return avisos
}

export function temErroBloqueante(d) {
  return avisosDoDestinatario(d).some(a => a.nivel === 'erro')
}
