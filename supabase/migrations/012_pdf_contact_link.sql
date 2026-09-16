-- ComunicaPro - Associação explícita entre PDF e contato
--
-- O casamento PDF x cliente é feito pelo código extraído do nome do arquivo.
-- Quando o código do arquivo e o do contato divergem (um dígito trocado no
-- cadastro, conta nova que ainda não está na lista), o PDF simplesmente não
-- aparece para ninguém — e até agora isso acontecia em silêncio.
--
-- contact_id permite corrigir o caso a caso sem reescrever o cadastro: o
-- código original do arquivo fica preservado, e o vínculo manual tem
-- precedência sobre o casamento automático.
alter table public.pdf_library
  add column if not exists contact_id uuid references public.contacts(id) on delete set null;

create index if not exists idx_pdf_contact on public.pdf_library(contact_id);
