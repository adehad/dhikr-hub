# https://gohugo.io/getting-started/installing/#docker
# https://hub.docker.com/r/hugomods/hugo/tags
FROM hugomods/hugo:exts-0.138.0

RUN apk add --no-cache tar

ENTRYPOINT ["bin/sh"]
