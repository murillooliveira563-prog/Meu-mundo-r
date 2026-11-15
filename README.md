# Meu Mundo R

Aplicativo pessoal em HTML, CSS e JavaScript, sem dependências nem etapa de build.

## Testar localmente

1. Abra esta pasta no VS Code.
2. Inicie o **Live Server** pelo `index.html`.
3. Use as áreas Hoje, Agenda, Meu ciclo e Meu espaço. O botão **+** abre diretamente o formulário de tarefa/lembrete; os botões de cada área criam registros do ciclo e anotações.
4. Em **Meu espaço**, escolha o tema claro/escuro e a cor de destaque (lilás, rosa, azul ou verde). Os dados e essas preferências ficam no IndexedDB deste navegador e não são enviados a um servidor. Limpar os dados do navegador pode apagá-los; não há backup.

## Limitações desta versão

- As preferências de aviso são apenas salvas; notificações automáticas não estão ativadas.
- O registro do ciclo é manual e não calcula previsões de ciclo ou fertilidade.
- O service worker e a instalação/offline precisam ser validados depois em hospedagem HTTPS e no iPhone. O navegador também precisa concluir um primeiro carregamento online bem-sucedido.
- Não há login, sincronização ou integração externa.
