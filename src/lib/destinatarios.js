// Monta a lista de destinatários a partir de contatos, grupos e PDFs.
//
// Regra central: um contato que pertence a um grupo NÃO aparece também
// sozinho. Se aparecesse, dava para selecionar o grupo e o contato ao mesmo
// tempo e a pessoa receberia a mensagem duas vezes. A exclusão é estrutural,
// não um aviso na tela.

import { extractClientCode } from './clientCode'

function maisRecente(a, b) {
  return new Date(a?.created_at || 0).getTime() > new Date(b?.created_at || 0).getTime()
}

/**
 * @returns lista de destinatários:
 *   { id, tipo: 'grupo'|'contato', nome, telefone, contatos[], pdfs[], semTelefone }
 */
export function montarDestinatarios(contacts, groups, pdfs) {
  // Quando o mesmo código tem vários PDFs (reenvio de um lote corrigido, por
  // exemplo), vale o MAIS RECENTE. A versão anterior simplesmente sobrescrevia
  // o mapa a cada volta e, como a lista vem do mais novo para o mais antigo,
  // quem sobrava no fim era justamente o arquivo mais velho — o cliente
  // receberia o relatório desatualizado.
  const pdfPorCodigo = new Map()
  for (const pdf of pdfs || []) {
    if (!pdf.client_code) continue
    const atual = pdfPorCodigo.get(pdf.client_code)
    if (!atual || maisRecente(pdf, atual)) pdfPorCodigo.set(pdf.client_code, pdf)
  }

  // Vínculo manual (feito na tela quando o código não bate) tem precedência
  // sobre o casamento automático por código.
  const pdfPorContato = new Map()
  for (const pdf of pdfs || []) {
    if (!pdf.contact_id) continue
    const atual = pdfPorContato.get(pdf.contact_id)
    if (!atual || maisRecente(pdf, atual)) pdfPorContato.set(pdf.contact_id, pdf)
  }

  const contatoPorId = new Map((contacts || []).map(c => [c.id, c]))
  const pdfDoContato = (c) => {
    if (!c) return null
    return pdfPorContato.get(c.id)
      || (c.client_code ? pdfPorCodigo.get(c.client_code) || null : null)
  }

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
export function avisosDoDestinatario(d, todos = []) {
  const avisos = []

  // Desde que o mesmo telefone pode ter várias contas, dois destinatários
  // distintos podem apontar para o mesmo número. Enviar assim manda duas
  // mensagens para a mesma pessoa — o grupo é o que resolve.
  if (d.telefone) {
    const outros = (todos || []).filter(x => x.id !== d.id && x.telefone === d.telefone)
    if (outros.length > 0) {
      avisos.push({
        nivel: 'erro',
        texto: `Este telefone também é de ${outros.map(o => o.nome).join(', ')}. ` +
               `Enviar assim manda mensagens repetidas para a mesma pessoa — junte num grupo.`,
      })
    }
  }

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

export function temErroBloqueante(d, todos = []) {
  return avisosDoDestinatario(d, todos).some(a => a.nivel === 'erro')
}
