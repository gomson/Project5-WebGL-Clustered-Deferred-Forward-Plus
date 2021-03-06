export default function (params) {
  return `
  /* 
    TODO:
    - Determine the cluster for a fragment
    - Read in the lights in that cluster from the populated data 
    - Do shading for just those lights
    - You may find it necessary to bind additional uniforms in src/renderers/clusteredForwardPlus.js
  */

  // TODO: This is pretty much just a clone of forward.frag.glsl.js

  #version 100
  precision highp float;

  uniform sampler2D u_colmap;
  uniform sampler2D u_normap;
  uniform sampler2D u_lightbuffer;

  // TODO: Read this buffer to determine the lights influencing a cluster
  uniform sampler2D u_clusterbuffer;

  // More uniforms 
  uniform float u_screenHeight;
  uniform float u_screenWidth;
  uniform float u_camFar;
  uniform float u_camNear;
  uniform mat4 u_viewMatrix;

  varying vec3 v_position;
  varying vec3 v_normal;
  varying vec2 v_uv;


  // ==========================================================================

  vec3 applyNormalMap(vec3 geomnor, vec3 normap) {
    normap = normap * 2.0 - 1.0;
    vec3 up = normalize(vec3(0.001, 1, 0.001));
    vec3 surftan = normalize(cross(geomnor, up));
    vec3 surfbinor = cross(geomnor, surftan);
    return normap.y * surftan + normap.x * surfbinor + normap.z * geomnor;
  }

  // --------------------------------------------------------------------------
  
  struct Light {
    vec3 position;
    float radius;
    vec3 color;
  };

  // --------------------------------------------------------------------------

  float ExtractFloat(sampler2D texture, int textureWidth, int textureHeight, int index, int component) {
    float u = float(index + 1) / float(textureWidth + 1);
    int pixel = component / 4;
    float v = float(pixel + 1) / float(textureHeight + 1);
    vec4 texel = texture2D(texture, vec2(u, v));
    int pixelComponent = component - pixel * 4;
    if (pixelComponent == 0) {
      return texel[0];
    } else if (pixelComponent == 1) {
      return texel[1];
    } else if (pixelComponent == 2) {
      return texel[2];
    } else if (pixelComponent == 3) {
      return texel[3];
    }
  }

  // --------------------------------------------------------------------------

  Light UnpackLight(int index) {
    Light light;
    float u = float(index + 1) / float(${params.numLights + 1});
    vec4 v1 = texture2D(u_lightbuffer, vec2(u, 0.3));
    vec4 v2 = texture2D(u_lightbuffer, vec2(u, 0.6));
    light.position = v1.xyz;

    // LOOK: This extracts the 4th float (radius) of the (index)th light in the buffer
    // Note that this is just an example implementation to extract one float.
    // There are more efficient ways if you need adjacent values
    light.radius = ExtractFloat(u_lightbuffer, ${params.numLights}, 2, index, 3);

    light.color = v2.rgb;
    return light;
  }

  // --------------------------------------------------------------------------

  // Cubic approximation of gaussian curve so we falloff to exactly 0 at the light radius
  float cubicGaussian(float h) {
    if (h < 1.0) {
      return 0.25 * pow(2.0 - h, 3.0) - pow(1.0 - h, 3.0);
    } else if (h < 2.0) {
      return 0.25 * pow(2.0 - h, 3.0);
    } else {
      return 0.0;
    }
  }

  // --------------------------------------------------------------------------
  
  // float ExtractLightInfoFromCluster(int u, int lightIdx) 
  // {
  //   int v = int(  floor(  (float(lightIdx) + 1.0) / 4.0  )  );
  //   vec4 pixelComponent = texture2D(u_clusterbuffer, vec2(u, v));   
  //   int lightIdxInTexture = int(mod(float(lightIdx) + 1.0, 4.0));
    
  //   if (lightIdxInTexture == 0) {
  //     return pixelComponent[0];
  //   } else if (lightIdxInTexture == 1) {
  //     return pixelComponent[1];
  //   } else if (lightIdxInTexture == 2) {
  //     return pixelComponent[2];
  //   } else if (lightIdxInTexture == 3) {
  //     return pixelComponent[3];
  //   }
  // }
  
  // --------------------------------------------------------------------------

  void main() 
  {
    vec4 _fragPos = u_viewMatrix * vec4(v_position, 1.0);
    vec3 fragPos = vec3(_fragPos[0], _fragPos[1], -1.0 * _fragPos[2]);  // Make sure to negate z

    float z_stride = float(u_camFar - u_camNear) / float(${params.z_slices});
    float y_stride = float(u_screenHeight) / float(${params.y_slices});
    float x_stride = float(u_screenWidth) / float(${params.x_slices});

    // gl_FragCoord.xy are in pixel/screen space, .z is in [0, 1]
    int z_cluster_idx = int(floor((fragPos[2] - u_camNear) / z_stride));

    int y_cluster_idx = int(floor(gl_FragCoord.y / y_stride)); 
    int x_cluster_idx = int(floor(gl_FragCoord.x / x_stride));
    // int y_cluster_idx = int(floor((gl_FragCoord.y + (u_screenHeight / 2.0)) / y_stride));
    // int x_cluster_idx = int(floor((gl_FragCoord.x + (u_screenWidth / 2.0)) / x_stride));

    //Test to see if you have 15 slices
    // gl_FragColor = vec4(float(x_cluster_idx)/15.0, float(x_cluster_idx)/15.0, float(x_cluster_idx)/15.0, 1.0);


    // Calculate u index into cluster texture
    int clusterIdx = x_cluster_idx + 
            (y_cluster_idx * ${params.x_slices}) + 
            (z_cluster_idx * ${params.x_slices} * ${params.y_slices});

    int totalNumClusters = ${params.x_slices} * ${params.y_slices} * ${params.z_slices};            
    int texWidth = int(ceil(float(${params.maxLightsPerCluster} + 1) / 4.0)); 
    const int maxLightsPerCluster = int(${params.maxLightsPerCluster});

    // Get the light count from cluster texture, iterate through that
    // Note: Textures go from [0, 1], so divide u and v by width and height before calling texture2D
    // "+ 1" to make sure you hit inside pixel 
    float u = float(clusterIdx + 1) / float(totalNumClusters + 1);
    vec4 firstVComponent = texture2D(u_clusterbuffer, vec2(u, 0));
    int numLightsInCluster = int(firstVComponent.r); 

    // Light Calculation
    vec3 albedo = texture2D(u_colmap, v_uv).rgb;
    vec3 normap = texture2D(u_normap, v_uv).xyz;
    vec3 normal = applyNormalMap(v_normal, normap);
    vec3 fragColor = vec3(0.0);

    for (int i = 0; i < maxLightsPerCluster; ++i) 
    {
      if(i >= numLightsInCluster)  break;

      // Get the light index in cluster texture 
      int lightIdxInTexture = int(ExtractFloat(u_clusterbuffer, totalNumClusters, texWidth, clusterIdx, i+1));  
      // int lightIdxInTexture = int(ExtractLightInfoFromCluster(u, i));

      Light light = UnpackLight(lightIdxInTexture);
      float lightDistance = distance(light.position, v_position);
      vec3 L = (light.position - v_position) / lightDistance;
      float lightIntensity = cubicGaussian(2.0 * lightDistance / light.radius);
      float lambertTerm = max(dot(L, normal), 0.0);
      fragColor += albedo * lambertTerm * light.color * vec3(lightIntensity);
    }

    const vec3 ambientLight = vec3(0.025);
    fragColor += albedo * ambientLight;
    gl_FragColor = vec4(fragColor, 1.0);

  }
  `;



  /*
      TODO: 

      - Determine the cluster this fragment belongs to 
          - Get current fragment with glFragCoord
          - ??? Make a cluster struct (like Lights). It would have numLights and listList
      - Read data inside u_clusterbuffer 
      - Loop over light indices 

      index -> pixel index
      pixel index => v coord of texture
      get texel from texture
      access correct component of texture

      pixel 0, component z
      pixel = (index + 1)/4
      component = (index + 1) - 4 * pixel

      v = (pixel + 1) / (max lights per cluter + 1 + 1)
      texel  = texture2d(buffer, vec2(uv))
      lightindex = texel[component]
      if(compoenet == 0)
      lightindex = texel[0]

      if(compoenet == 1)
      lightindex = texel[1]

      if(compoenet == 2)
      lightindex = texel[2]

      if(compoenet == 3)
      lightindex = texel[3]


      dividing by texture 
      (2 + 1)/ (5 + 1)




      ------------------ OTHER NOTES ------------------

      // send inverse projection matrix and number of slices to fragment shader to bring into view space
      // position is in world space (v_position from vertex shader), and you want it in eye space. multiply by view matrix 
      //do this to get z coord
      //glfragcoord.xy to get x and y (this is your pixel position)
      // you need to send height and width of screen 


      ------------------ WHITEBOARD NOTES ------------------
      you get v_position from vertex shader. this is in world space
      multiply this by view matrix to bring the position into camera space 
      this means you need to pass in the view matrix into the fragment shader

      get the z value from this, floor it to the chunks of slice size
      if in camera space, it goes from 0 to farPlaneZ (FIGURE OUT HOW TO GET THIS)
          divide the space by 15 (slice size), and find which slice of 15th the z value floors to
      
      identify the cluster the fragment is located in

      get the x and y value for the fragment with glFragCoord.xy. this is in pixel space
      need to pass in screen width and height
      divide x and y by 15 (or whatever your cluster logic is), then floor or ceil it

      find index value into cluster texture using x, y, z
      get uv coord
      get light info
      iterate through those lights for that current cluster
  */


}//end export default function
