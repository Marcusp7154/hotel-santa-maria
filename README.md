# Hotel Santa Maria — Painel da recepção

Painel web (Next.js 15 + Supabase) da fase 1 do sistema de gestão do hotel.

## O que tem nesta versão

- **Login** da equipe com e-mail e senha (usuários criados no Supabase).
- **Hoje**: ocupação, chegadas, saídas, hospedados, saldo de cada conta, atribuição de quarto,
  check-in, venda de produtos (para pagar na saída ou pago na hora), recebimento (dinheiro, Pix,
  débito, crédito, transferência), check-out, auditoria noturna e o status de cada quarto.
- **Notinha**: tudo o que o hóspede consumiu, o que já pagou e o saldo, pronta para imprimir.
- **Cadastros**: tipos de quarto e quartos, produtos com estoque e equipe (logins e perfis).
- **Estoque**: entrada de mercadoria, ajuste pela contagem e perda; baixa automática a cada venda,
  devolução quando a venda é estornada, bloqueio de venda sem saldo e aviso de estoque baixo.
- **Meu caixa**: abrir turno, sangria e suprimento, dinheiro esperado na gaveta e fechamento com diferença.
- **Mapa de ocupação**: 14 dias por quartos, agrupado por tipo, navegando de 7 em 7 dias.

Cada perfil vê só o que pode: a governança não vê nada financeiro; recepção não mexe em cadastros.
As regras ficam no banco (pasta `banco/`), então valem mesmo fora do painel.

## Scripts do banco (rodar no SQL Editor do Supabase, uma vez cada, nesta ordem)

1. `banco/hotel_fase1.sql`: estrutura, regras e permissões.
2. `banco/hotel_fase1b.sql`: venda com pagamento no ato.
3. `banco/hotel_fase1c.sql`: controle de estoque. Produtos que já existiam ficam sem controle
   até você marcar "Controlar estoque" e lançar a entrada.

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

## Atualização 2: cadastros, notinha e venda na recepção

1. **Banco**: no Supabase, *SQL Editor > New query*, cole o arquivo `hotel_fase1b.sql` e clique em *Run*.
2. **Chave secreta** (para o administrador criar logins da equipe pelo sistema):
   - No Supabase, *Project Settings > API Keys*, copie a **Secret key** (começa com `sb_secret_`).
     Não compartilhe essa chave com ninguém nem coloque no código.
   - Na Vercel, abra o projeto > *Settings > Environment Variables* > *Add*:
     nome `SUPABASE_SECRET_KEY`, valor = a chave copiada, ambientes *Production* e *Preview*. Salve.
   - Em *Deployments*, nos três pontinhos do último deploy, clique em *Redeploy* para a chave valer.
3. **Fechar o cadastro público**: no Supabase, *Authentication > Sign In / Providers*, desligue
   *Allow new users to sign up*. Assim só o administrador cria logins.

## Rodar no próprio computador (opcional)

Precisa do Node.js 20 ou mais novo.

```bash
npm install
npm run dev
```

Abra http://localhost:3000.

## Cadastrar a equipe

Pelo sistema: *Cadastros > Equipe* (só o administrador vê). Informe nome, e-mail, uma senha
provisória e o perfil. Depois, passe a senha para a pessoa. Na mesma tela dá para trocar a senha,
mudar o perfil ou tirar o acesso de quem saiu.

## Estrutura

```
app/
  login/page.jsx        tela de login
  sair/route.js         logout
  (painel)/layout.jsx   topo com menu e usuário
  (painel)/page.jsx     tela Hoje
  (painel)/acoes.jsx    botões e formulários (check-in, caixa, consumo…)
  (painel)/mapa/        mapa de ocupação
  (painel)/conta/[id]/  notinha do hóspede (itens, pagamentos, saldo, imprimir)
  (painel)/cadastros/   quartos, produtos e equipe
  api/equipe/route.js   cria logins e troca senhas (usa a chave secreta, só no servidor)
lib/
  config.js             endereço e chave pública do Supabase
  formato.js            datas, moeda e nomes dos status
  supabase/             conexão com o Supabase (navegador, servidor e admin)
middleware.js           mantém a sessão e protege as páginas
```
