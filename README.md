# Maquete 3D Interativa — Praça da Juventude (Canabrava, Salvador/BA)

> **🔗 Link público (Vercel):** https://maquete-praca-juventude.vercel.app
> **Repositório:** https://github.com/ANTHONY20-melo/maquete-praca-juventude

Reconstrução **fiel à realidade** da Praça da Juventude da Canabrava —
Av. Artêmio Castro Valente, 380‑346, Salvador/BA (em frente ao estacionamento do Barradão).

> **Fontes reais utilizadas:** footprints do OpenStreetMap (ginásio 37,5 × 26,2 m; campo society
> 28 × 48 m em terra; quadra de areia 12,4 × 23,9 m; pista de skate 25 × 13,5 m; muro perimetral,
> ruas e endereço) + imagem de satélite (muro de alvenaria, portaria laranja, loop de caminhada
> com academia ao ar livre, quiosque, playground junto à entrada, estacionamento de rua).

## Como abrir (2 cliques)

Abra **`index.html`** no Chrome ou Edge — duplo clique. Funciona **100% offline**
(Three.js incluído em `libs/`). Para servir em rede local: `npx serve .`

## Modos de uso

| Modo | Como ativar | Para quê |
|------|-------------|----------|
| **Vista Geral** (orbital) | Botão "Vista Geral" | Apresentação em tela/TV: girar com mouse, zoom com scroll |
| **Avatar (passeio)** | Botão "Avatar" + clique na tela | Simular circulação de pessoas em 3ª pessoa, colisões reais |
| **1ª pessoa** | Tecla `V` no modo Avatar | Visão do operador em campo |

## Camadas do projeto

| Camada | Atalho | O que mostra |
|--------|--------|--------------|
| **Segurança** | `S` (na vista geral) | E1 Portão norte (Rua Flor de Maracujá) e E2 Portão sul (trilha); câmeras C1–C4 nos vértices do muro com cones de cobertura; PM Posto médico de campanha junto ao E1; BO Base operacional e comando na ala oeste; PE Ponto de encontro e triagem no campo; barricadas nos portões |
| **Rótulos** | `L` | Nomes completos flutuando **acima** de cada estrutura: ginásio, vestiários, campo, 2 quadras de areia, skate, pista perimetral, academia, quiosque, playground, portaria, ruas, estacionamento |
| **Telhado** | `T` | Telhado do ginásio translúcido para inspeção interna |
| **Evacuação** | `E` | Rotas verdes para os 2 portões + corredores amarelos de convergência |

## Simulações (para planejamento e treinamento da equipe)

| Botão / tecla | O que faz |
|---------------|-----------|
| **Pessoas** (`P`) | 26 pessoas caminham pelos circuitos reais: pista perimetral, loop do ginásio, corredores, quadras e ruas |
| **Incêndio** (`F`) | Foco de incêndio com chamas, fumaça volumétrica, alarme pulsante e círculo de isolamento. **Clique no chão** para mover o foco. A viatura do **Corpo de Bombeiros** chega pelo E1 em ~3 s (percorre a Av. Artêmio Castro Valente) |
| **▶ Evacuar Agora** (`X`) | Multidão calcula a rota mais curta (grafo L0-E1/E2) e evacua; barra de status mostra **fora de risco / total** e o **tempo**; pessoas evacuadas ficam verdes do lado de fora |

Fogo ativo + multidão ativa = evacuação emergencial automática (treino completo).

### Texturas procedurais
Sem arquivos externos — grama, terra batida, areia (com ondas), asfalto, concreto,
emborrachado e pista são geradas em canvas e aplicadas nos pisos (matGL Lambert + tint).

### Pista de caminhada perimetral
Faixa de terra batida de ~3,6 m que **contorna todo o complexo** (contorno OSM real,
inset de 1,6 m do muro), com linha de faixa nos dois bordos e rótulo "CIRCUITO COMPLETO".
O loop menor a leste do ginásio permanece (satélite) como **conector interno**.

### Duas quadras de areia no mesmo terreno
O terreno de 12,4 × 23,9 m abriga **2 quadras lado a lado** (norte e sul), cada uma com
rede própria, placa numerada ("QUADRA DE AREIA 1 / 2") e acesso livre — dá para **entrar**
nelas, inclusive de avatar em 1ª pessoa. O ginásio também está **aberto com portão de 4 m**
na face sul (painéis azuis abertos) — entre e veja a quadra interna de dentro.

## O que foi recriado (posições reais)

- **Muro perimetral** de alvenaria (~2,2 m) no contorno verdadeiro do cercado, com pilares
- **Portão norte E1** (principal, acesso pela Rua Flor de Maracujá) + **portão sul E2** (trilha)
- **Portaria** (cabine laranja) na entrada norte + cancela + faixa de pedestres
- **Placa de identificação**: nome, endereço completo e "Aberta 24h"
- **Ginásio Poliesportivo Coberto** 37,5 × 26,2 m — telhado de duas águas cinza, pano
  translúcido, piso de quadra interno, 2 portões de acesso
- **Bloco de Vestiários e Salas de Apoio** (anexo em "L" com caixas d'água)
- **Campo de Futebol Society** 28 × 48 m em terra batida avermelhada (como no satélite)
- **Quadras de Futevôlei** — **2 quadras de areia no mesmo terreno** 12,4 × 23,9 m,
  cada meia-quadra com rede + placa numerada
- **Pista de Skate** 25 × 13,5 m (quarterpipes, funbox, corrimão)
- **Pista de Caminhada PERIMETRAL** que dá a volta no complexo inteiro
  + loop interno a leste do ginásio + **Academia ao Ar Livre**
  no miolo (equipamentos de barra, prancha, barra dupla)
- **Quiosque azul** no nordeste do loop · **Playground** rosa/amarelo junto ao muro norte
- **Área Verde** a leste (expansão futura)
- **Contexto regional**: Av. Artêmio Castro Valente (via expressa, 2 pistas com linha central),
  Rua Flor de Maracujá contornando a praça, estacionamento de rua com carros, mata a oeste/sul

## Avatar — controle

`W A S D` caminhar (S recua) · `Shift` correr · `V` 1ª/3ª pessoa · `Esc` solta o mouse
Entrada: nasce junto ao Portão E1 e pode atravessar os portões, entrar no ginásio,
correr no campo e/ou usar o corredor entre as quadras. Colisões com muro, ginásio, anexo,
quiosque e portaria.

## Celular / tablet (controles de toque)

- **Vista Geral:** arraste 1 dedo para girar 360° · **pinça** de 2 dedos para zoom ·
  toque curto no chão com incêndio ativo move o foco.
- **Avatar:** **joystick** flutuante no lado esquerdo da tela para andar
  (empurre até a borda = correr) · **arraste** o restante da tela para olhar 360° ·
  botão **1ª / 3ª Pessoa** aparece no painel.
- Funciona no link da Vercel e no arquivo local; em celular o navegador não tem
  pointer lock, então o olhar é sempre por arraste.

## Estrutura

```
maquete-praca-juventude/
├── index.html        ← abra este
├── app.js            ← motor da maquete (coordenadas reais em metros)
├── libs/three.min.js ← Three.js r147 (offline)
└── README.md
```

## Customização rápida (app.js)

- Todos os blocos têm comentários com as medidas reais e coordenadas (X=leste, Z=sul).
- Câmeras de segurança: vetor `cams` na seção SEGURANÇA.
- Rotas de evacuação: `arrow([origem], [destino], cor)` na seção evacuation().
- Muro: função `wallSeg(x1,z1,x2,z2)` — fácil de adicionar/abrir vãos.

## Verificação

`sat_praca.png` — mosaico do satélite usado como referência da reconstrução.
