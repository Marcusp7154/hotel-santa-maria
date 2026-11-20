-- =====================================================================
--  SISTEMA DE GESTÃO HOTELEIRA — FASE 1M
--  Ficha de hospedagem no modelo impresso do hotel (FNRH).
--
--  Como aplicar: Supabase > SQL Editor > New query, cole e clique em Run.
--  Pode rodar mais de uma vez.
--
--  Acrescenta os campos da ficha de papel:
--   - no hóspede: sexo, telefone fixo, CEP, profissão, RG e órgão expedidor;
--   - na estadia: motivo da viagem, transporte, origem, próximo destino,
--     placa do carro e acompanhantes;
--   - no hotel: Instagram, CEP e segundo telefone (cabeçalho da ficha).
-- =====================================================================

alter table public.hospedes
  add column if not exists sexo      text check (sexo in ('F', 'M', 'O')),
  add column if not exists telefone2 text,
  add column if not exists cep       text,
  add column if not exists profissao text,
  add column if not exists rg        text,
  add column if not exists rg_orgao  text;
comment on column public.hospedes.telefone2 is 'Telefone fixo (o campo telefone é o celular/WhatsApp).';

alter table public.reservas
  add column if not exists motivo_viagem   text check (motivo_viagem in
    ('turismo', 'negocio', 'convencao', 'lazer', 'saude', 'religioso', 'esporte', 'outros')),
  add column if not exists transporte      text check (transporte in ('automovel', 'onibus', 'van', 'aviao', 'outro')),
  add column if not exists procedencia     text,
  add column if not exists proximo_destino text,
  add column if not exists placa_carro     text,
  add column if not exists acompanhantes   jsonb not null default '[]'::jsonb
    check (jsonb_typeof(acompanhantes) = 'array');
comment on column public.reservas.procedencia is 'Origem do hóspede (cidade - país), campo da ficha.';
comment on column public.reservas.acompanhantes is 'Lista de acompanhantes: [{ "nome": "...", "idade": 10 }].';

alter table public.hoteis
  add column if not exists instagram text,
  add column if not exists cep       text,
  add column if not exists telefone2 text;

-- Dados do cabeçalho da ficha de papel (só preenche o que estiver vazio)
update public.hoteis set
  telefone  = coalesce(nullif(telefone, ''), '(99) 98128-9074'),
  telefone2 = coalesce(nullif(telefone2, ''), '(99) 3621-1076'),
  instagram = coalesce(nullif(instagram, ''), '@hotelsantamariabacabal'),
  endereco  = coalesce(nullif(endereco, ''), 'Rua Magalhães de Almeida, 319 - Centro'),
  cep       = coalesce(nullif(cep, ''), '65700-000'),
  cidade    = coalesce(nullif(cidade, ''), 'Bacabal'),
  uf        = coalesce(nullif(uf, ''), 'MA')
where nome ilike '%santa maria%';
