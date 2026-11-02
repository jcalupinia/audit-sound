#pragma once

// Cliente Subsonic para el servidor (issue M2): habla con Navidrome u otro
// servidor Subsonic. Autenticación por token (salt + md5), listado de canciones
// y descarga del archivo original a disco (para que el motor lo decodifique).

#include <string>
#include <vector>

struct SubsonicSong {
  std::string id;
  std::string suffix;  // mp3, flac, opus, m4a, …
  std::string title;
};

class SubsonicClient {
 public:
  SubsonicClient(std::string baseUrl, std::string user, std::string pass,
                 std::string clientName = "AUDIT-SOUND");

  // Verifica credenciales/servidor. err opcional recibe el motivo.
  bool ping(std::string* err = nullptr);

  // n canciones aleatorias (getRandomSongs). Vacío si falla.
  std::vector<SubsonicSong> randomSongs(int n);

  // Canciones de una playlist (getPlaylist). Vacío si falla.
  std::vector<SubsonicSong> playlistSongs(const std::string& playlistId);

  // Descarga el archivo ORIGINAL de la canción a outPath (sin transcodificar).
  // Devuelve true si se escribió un archivo no vacío.
  bool download(const SubsonicSong& song, const std::string& outPath);

 private:
  std::string authQuery() const;
  // GET de un endpoint rest (p. ej. "getRandomSongs"); devuelve el cuerpo JSON.
  std::string restGet(const std::string& endpoint, const std::string& extra);

  std::string base_;
  std::string user_;
  std::string pass_;
  std::string client_;
};
