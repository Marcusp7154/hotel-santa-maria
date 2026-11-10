# Hotel Santa Maria — Painel da recepção

Painel web (Next.js 15 + Supabase) da fase 1 do sistema de gestão do hotel.

## O que tem nesta versão

- **Login** da equipe com e-mail e senha (usuários criados no Supabase).
- **Hoje**: ocupação, chegadas, saídas, hospedados, saldo de cada conta, atribuição de quarto,
  check-in, lançamento de consumo, recebimento (dinheiro, Pix, débito, crédito, transferência),
  check-out, auditoria noturna e o status de cada quarto para a governança.
- **Meu caixa**: abrir turno, sangria e suprimento, dinheiro esperado na gaveta e fechamento com diferença.
- **Mapa de ocupação**: 14 dias por quartos, agrupado por tipo, navegando de 7 em 7 dias.

Cada perfil vê só o que pode: a governança não vê nada financeiro; recepção não mexe em cadastros.
As regras ficam no banco (arquivo `hotel_fase1.sql`), então valem mesmo fora do painel.

## Publicar na Vercel

1. **GitHub**: crie um repositório privado chamado `hotel-santa-maria`. Na página do repositório vazio,
   clique em *uploading an existing file*, arraste **o conteúdo** desta pasta (não a pasta em si)
   e clique em *Commit changes*.
2. **Vercel**: *Add New… > Project*, escolha o repositório `hotel-santa-maria` e clique em *Deploy*.
   A Vercel reconhece o Next.js sozinha. Não precisa configurar variáveis: o endereço e a chave
   pública do Supabase já estão em `lib/config.js`.
3. **Supabase**: em *Authentication > URL Configuration*, coloque o endereço que a Vercel gerou
   (ex.: `https://hotel-santa-maria.vercel.app`) em *Site URL*. Isso é usado nos e-mails de
   recuperação de senha.

Toda alteração enviada ao GitHub é publicada automaticamente pela Vercel em cerca de 1 minuto.

## Rodar no próprio computador (opcional)

Precisa do Node.js 20 ou mais novo.

```bash
npm install
npm run dev
```

Abra http://localhost:3000.

## Cadastrar a equipe

1. No Supabase, *Authentication > Users > Add user*: crie o login (e-mail e senha).
2. No *SQL Editor*, ligue o login ao hotel com o perfil certo (`gerente`, `recepcao` ou `governanca`):

```sql
insert into public.perfis (id, hotel_id, nome, perfil)
select u.id, h.id, 'Nome da pessoa', 'recepcao'
from auth.users u, public.hoteis h
where u.email = 'email-da-pessoa@exemplo.com' and h.nome = 'Hotel Santa Maria';
```

## Estrutura

```
app/
  login/page.jsx        tela de login
  sair/route.js         logout
  (painel)/layout.jsx   topo com menu e usuário
  (painel)/page.jsx     tela Hoje
  (painel)/acoes.jsx    botões e formulários (check-in, caixa, consumo…)
  (painel)/mapa/        mapa de ocupação
lib/
  config.js             endereço e chave pública do Supabase
  formato.js            datas, moeda e nomes dos status
  supabase/             conexão com o Supabase (navegador e servidor)
middleware.js           mantém a sessão e protege as páginas
```
