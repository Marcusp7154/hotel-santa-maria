#!/bin/bash
# Testes do banco: cria um banco novo num PostgreSQL local, aplica os scripts na ordem do
# README e roda cada bateria de testes logo depois do seu script.
# Uso:  PGPORT=5432 ./banco/testes/rodar_testes.sh     (precisa de psql e de um PostgreSQL 15+)
set -u
AQUI="$(cd "$(dirname "$0")" && pwd)"; BANCO="$AQUI/.."; DB=${DB:-hotel_testes}
P="psql -X -q -v ON_ERROR_STOP=1"
psql -X -q -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null || exit 1
falhas=0
aplica() { $P -d $DB -f "$1" >/dev/null 2>/tmp/erro_teste.txt || { echo "ERRO ao aplicar $(basename "$1")"; grep -v NOTICE /tmp/erro_teste.txt | tail -3; falhas=$((falhas+1)); }; }
testa() {
  saida=$(psql -X -d $DB -f "$AQUI/$1" 2>&1 | grep -E '\| (OK|FALHOU)')
  ok=$(echo "$saida" | grep -c '| OK'); f=$(echo "$saida" | grep -c 'FALHOU')
  echo "$1: $ok OK, $f falha(s)"; [ "$f" -gt 0 ] && echo "$saida" | grep FALHOU; falhas=$((falhas+f))
}
aplica "$AQUI/00_supabase_simulado.sql"
aplica "$BANCO/hotel_fase1.sql";  testa teste_fase1.sql
aplica "$BANCO/hotel_fase1b.sql"; testa teste_fase1b.sql
aplica "$BANCO/hotel_fase1c.sql"; testa teste_fase1c.sql
aplica "$BANCO/hotel_fase1d.sql"; testa teste_fase1d.sql
aplica "$BANCO/hotel_fase1e.sql"; testa teste_fase1e.sql
aplica "$BANCO/hotel_fase1f.sql"; aplica "$BANCO/hotel_fase1g.sql"
aplica "$BANCO/hotel_fase1h.sql"; testa teste_fase1h.sql
aplica "$BANCO/hotel_fase1i.sql"; testa teste_fase1i.sql
aplica "$BANCO/hotel_fase1j.sql"; testa teste_fase1j.sql
aplica "$BANCO/hotel_fase1k.sql"   # teste do lucro roda no fim, depois da correção das perdas (1o)
aplica "$BANCO/hotel_fase1l.sql"; testa teste_fase1l.sql
aplica "$BANCO/hotel_fase1m.sql"
aplica "$BANCO/hotel_fase1n.sql"; testa teste_fase1n.sql
aplica "$BANCO/hotel_fase1o.sql"; testa teste_fase1o.sql
aplica "$BANCO/hotel_fase1p.sql"; testa teste_fase1p.sql
testa teste_fase1k.sql
echo; [ "$falhas" -eq 0 ] && echo "TUDO OK" || { echo "$falhas problema(s)"; exit 1; }
