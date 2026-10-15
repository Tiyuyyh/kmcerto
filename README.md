# KM Certo

App pessoal para saber, antes de aceitar uma corrida do BEE Delivery (abelha), de onde ela sai, para onde vai e quanto paga por quilômetro.

No futuro poderá receber outros aplicativos que não informam esses dados. Esta página é de teste e não é adequada para uso real.

Você informa a loja e o endereço do cliente. O app calcula:

- distância da sua posição até a loja, pelas ruas;
- distância da loja até o cliente, pelas ruas;
- total de km;
- valor por km (valor pago ÷ total de km).

Esta versão é a web, usada para testar a lógica e o visual. O app Android com o botão flutuante vem depois, reaproveitando essa lógica.

## Estrutura de pastas

- `index.html`: a página principal (todas as telas).
- `css/paleta.css`: as cores do app. Para trocar uma cor, mude só este arquivo.
- `css/style.css`: os estilos (layout, botões, barra inferior).
- `js/app.js`: toda a lógica (localização, busca de endereço, mapa, rotas, cálculo, opções e histórico).
- `README.md`: este documento.

## Como usar

1. Toque em **Minha localização** (a posição só é obtida quando você pede).
2. Informe a loja, o endereço do cliente e o valor pago.
3. Toque em **Calcular**.
   - Se a loja já estiver cadastrada, o cálculo sai direto.
   - Se for loja nova, o app mostra o mapa. Arraste o marcador até o ponto exato e confirme. A loja fica cadastrada.

## Telas

- **Painel KM (topo):** distância até a loja, loja → cliente, total e R$ por km.
- **Visor (meio):** formulário, mapa de confirmação, opções e histórico.
- **Barra inferior:**
  - **Home:** formulário principal.
  - **Opções:** cidade padrão para as buscas, lojas cadastradas, apagar histórico.
  - **Histórico:** cada consulta, com data, loja, cliente, km e R$ por km.

## Tecnologia

- HTML, CSS e JavaScript puros, sem framework nem etapa de build. Carrega rápido e roda em qualquer navegador.
- Mapa: [Leaflet](https://leafletjs.com/) com tiles do OpenStreetMap. Carregado só quando o mapa é usado.
- Endereço: Nominatim (OpenStreetMap).
- Rota pelas ruas: OSRM, servidor público de demonstração.
- Dados (lojas, histórico, cache de rotas e endereços) ficam no `localStorage` do próprio navegador. Nada é enviado a outro servidor, exceto as buscas de endereço e de rota.

## Limites e cuidados

- **Servidores públicos:** OSRM e Nominatim são gratuitos e não devem receber uso intenso. O app guarda em cache as rotas e os endereços já buscados para reduzir chamadas. Se o uso crescer, a troca é trocar a URL base, ou hospedar um servidor próprio.
- **Precisão:** a rota segue o sistema de ruas do OpenStreetMap. Locais novos ou mal mapeados podem sair um pouco diferentes do Google Maps. Por isso o marcador da loja é confirmado à mão.
- **Nomes diferentes:** se o nome da loja na tela vier diferente do cadastro (ex.: "Drogazil" para "Drogasil 3"), o app não reconhece e pede confirmação no mapa.
- **Veículo:** o cálculo usa o perfil de carro. Se a corrida for de moto e houver atalhos que só moto usa, a distância pode sair um pouco maior.

## Decisões tomadas

- Distância pelas ruas, não em linha reta, porque há trechos que o entregador não consegue atravessar.
- Google Maps não é usado nesta versão (cota gratuita, sem orçamento para estourar).
- Localização só sob demanda, para não gastar cota e não ficar rastreando.
- Sem frameworks e sem build, para facilitar a manutenção e a migração para outra ferramenta.

## Publicação

O site é servido pelo GitHub Pages a partir da branch `main`, na raiz do repositório. Qualquer alteração enviada à `main` aparece no site em um ou dois minutos.

## Pendências

- Definir a cidade padrão de busca em **Opções**.
- Validar, em corridas reais, se a distância fica dentro da margem de 10% aceita.
- Definir o visual final do menu inferior a partir do print de referência.
- Projetar o app Android (botão flutuante e leitura da tela do BI Delivery).

## Contribuidores

- **Tiyuyyh**: dono do projeto, define as regras, testa e decide as mudanças.
- **Claude** (modelo Claude Haiku 5.5, Anthropic): escreve o código, a documentação e os ajustes a partir das instruções.
