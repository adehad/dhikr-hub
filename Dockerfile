# https://gohugo.io/getting-started/installing/#docker
# https://hub.docker.com/r/hugomods/hugo/tags
FROM hugomods/hugo:exts-0.153.3

RUN apk add --no-cache tar

ENTRYPOINT ["bin/sh"]
